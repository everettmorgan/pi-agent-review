import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
	ToolCallEvent,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type * as Config from '../src/config.ts';
import agentReview from '../src/index.ts';

const {loadConfigMock} = vi.hoisted(() => ({loadConfigMock: vi.fn()}));

vi.mock('../src/config.ts', async importOriginal => ({
	...(await importOriginal<typeof Config>()),
	loadConfigFromPath: loadConfigMock,
}));

type EventHandler = (event: unknown, context: unknown) => Promise<unknown>;

function setup() {
	const handlers = new Map<string, EventHandler>();
	let command: Omit<RegisteredCommand, 'name' | 'sourceInfo'> | undefined;
	let tool: ToolDefinition | undefined;
	const pi = {
		on: vi.fn((event: string, handler: EventHandler) => handlers.set(event, handler)),
		registerTool: vi.fn((definition: ToolDefinition) => {
			tool = definition;
		}),
		registerCommand: vi.fn((name: string, definition: Omit<RegisteredCommand, 'name' | 'sourceInfo'>) => {
			command = definition;
		}),
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
		registerMessageRenderer: vi.fn(),
	} as unknown as ExtensionAPI;
	agentReview(pi);
	if (command === undefined || tool === undefined) {
		throw new Error('command or tool was not registered');
	}

	return {
		pi, handlers, command, tool,
	};
}

function commandContext() {
	const notify = vi.fn();
	const setStatus = vi.fn();
	// eslint-disable-next-line @typescript-eslint/naming-convention
	return {context: {hasUI: true, ui: {notify, setStatus}} as unknown as ExtensionCommandContext, notify, setStatus};
}

const sessionStatus = vi.fn();
// eslint-disable-next-line @typescript-eslint/naming-convention
const sessionContext = {hasUI: true, ui: {setStatus: sessionStatus}, sessionManager: {getBranch: () => []}} as unknown as ExtensionContext;

const toolContext = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	cwd: '/repo', hasUI: true, ui: {setStatus: vi.fn()}, sessionManager: {getBranch: () => []},
} as unknown as ExtensionContext;

function secretToolCall(): ToolCallEvent {
	return {toolName: 'read', input: {path: '.env'}} as unknown as ToolCallEvent;
}

async function fireToolCall(handlers: Map<string, EventHandler>): Promise<unknown> {
	const handler = handlers.get('tool_call');
	if (handler === undefined) {
		throw new Error('tool_call handler was not registered');
	}

	return handler(secretToolCall(), toolContext);
}

async function fireSessionStart(handlers: Map<string, EventHandler>, reason: string): Promise<void> {
	const handler = handlers.get('session_start');
	if (handler === undefined) {
		throw new Error('session_start handler was not registered');
	}

	await handler({type: 'session_start', reason}, sessionContext);
}

describe('agentReview wiring', () => {
	beforeEach(async () => {
		loadConfigMock.mockReset();
		const {defaultConfig} = await vi.importActual<typeof Config>('../src/config.ts');
		loadConfigMock.mockResolvedValue({ok: true, value: defaultConfig});
	});

	it('registers the command, approval tool, log renderer, and all event handlers', () => {
		const {pi, handlers} = setup();
		// eslint-disable-next-line unicorn/prefer-iterator-to-array
		expect([...handlers.keys()].toSorted()).toEqual(['session_start', 'session_tree', 'tool_call', 'tool_result', 'turn_start']);
		expect(pi.registerCommand).toHaveBeenCalledWith('agent-review', expect.anything());
		expect(pi.registerMessageRenderer).toHaveBeenCalledWith('agent-review-log', expect.any(Function));
	});

	it('review is armed by default: the hard gate blocks a secret read', async () => {
		const {handlers} = setup();
		expect(await fireToolCall(handlers)).toMatchObject({block: true});
	});

	it('shows a persistent footer indicator: review on at session start, review off after toggling', async () => {
		const {handlers, command} = setup();
		sessionStatus.mockClear();

		await fireSessionStart(handlers, 'startup');
		expect(sessionStatus).toHaveBeenCalledWith('agent-review', 'review on');

		const off = commandContext();
		await command.handler('off', off.context);
		expect(off.setStatus).toHaveBeenCalledWith('agent-review', 'review off');
	});

	it('off disables review across forks and re-arms on a new session', async () => {
		const {handlers, command} = setup();

		await command.handler('off', commandContext().context);
		expect(await fireToolCall(handlers)).toBeUndefined();

		await fireSessionStart(handlers, 'fork');
		expect(await fireToolCall(handlers)).toBeUndefined();

		await fireSessionStart(handlers, 'new');
		expect(await fireToolCall(handlers)).toMatchObject({block: true});
	});

	it('re-arms on resume', async () => {
		const {handlers, command} = setup();

		await command.handler('off', commandContext().context);
		await fireSessionStart(handlers, 'resume');

		expect(await fireToolCall(handlers)).toMatchObject({block: true});
	});

	it('status reports pending approvals recorded through the real tool', async () => {
		const {command, tool} = setup();
		// eslint-disable-next-line @typescript-eslint/naming-convention
		const approvalContext = {cwd: '/repo', hasUI: true, ui: {confirm: vi.fn().mockResolvedValue(true)}} as unknown as ExtensionContext;
		await tool.execute('call-1', {toolName: 'bash', input: {command: 'npm publish'}, reason: 'ship it'}, undefined, undefined, approvalContext);

		const {context, notify} = commandContext();
		await command.handler('status', context);

		const [message] = notify.mock.calls[0] as [string];
		expect(message).toContain('Pending approvals: bash');
		expect(message).toContain('Grants consumed: 0');
	});
});
