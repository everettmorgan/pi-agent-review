import type {
	ExtensionAPI,
	ExtensionContext,
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
import {ApprovalLedger} from '../src/approval/approval-ledger.ts';
import {registerApprovalTool} from '../src/approval/approval-tool.ts';
import type * as Config from '../src/config.ts';
import type * as RunReview from '../src/review/run-review.ts';
import {createRuntimeState} from '../src/runtime-state.ts';
import {createToolCallHandler} from '../src/tool-call-handler.ts';

const {performReviewMock, loadConfigMock} = vi.hoisted(() => ({
	performReviewMock: vi.fn(),
	loadConfigMock: vi.fn(),
}));

vi.mock('../src/review/run-review.ts', async importOriginal => ({
	...(await importOriginal<typeof RunReview>()),
	performReview: performReviewMock,
}));
vi.mock('../src/config.ts', async importOriginal => ({
	...(await importOriginal<typeof Config>()),
	loadConfigFromPath: loadConfigMock,
}));

function setup() {
	const ledger = new ApprovalLedger();
	const appendEntry = vi.fn();
	let tool: ToolDefinition | undefined;
	const pi = {
		appendEntry,
		registerTool(definition: ToolDefinition) {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	registerApprovalTool(pi, ledger);
	if (tool === undefined) {
		throw new Error('tool was not registered');
	}

	const handler = createToolCallHandler(pi, createRuntimeState(), ledger);
	return {
		ledger, tool, handler, appendEntry,
	};
}

async function recordApproval(tool: ToolDefinition, toolName: string, input: unknown, cwd: string): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const context = {cwd, hasUI: true, ui: {confirm: vi.fn().mockResolvedValue(true)}} as unknown as ExtensionContext;
	await tool.execute('call-1', {toolName, input, reason: 'requested by the user'}, undefined, undefined, context);
}

function toolCallContext(cwd: string): ExtensionContext {
	return {cwd, sessionManager: {getBranch: () => []}} as unknown as ExtensionContext;
}

describe('approval flow end to end (real tool, real ledger, real handler)', () => {
	beforeEach(async () => {
		performReviewMock.mockReset();
		loadConfigMock.mockReset();
		const {defaultConfig} = await vi.importActual<typeof Config>('../src/config.ts');
		loadConfigMock.mockResolvedValue({ok: true, value: defaultConfig});
	});

	it('mechanically authorizes the identical retry, even with different key order, without the reviewer', async () => {
		const {ledger, tool, handler, appendEntry} = setup();
		performReviewMock.mockRejectedValue(new Error('the reviewer must not be called on an exact match'));
		await recordApproval(tool, 'deploy', {flags: {force: true, region: 'us-east-1'}, project: 'prod'}, '/repo');

		const event = {toolName: 'deploy', input: {project: 'prod', flags: {region: 'us-east-1', force: true}}} as unknown as ToolCallEvent;
		const result = await handler(event, toolCallContext('/repo'));

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
		expect(appendEntry).toHaveBeenCalledWith('agent-review-consumption', expect.objectContaining({nonce: expect.any(String) as string}));
		expect(ledger.findPendingForTool('deploy', Date.now())).toBeUndefined();
	});

	it('routes the same input from a different cwd to the reviewer instead of the fast path', async () => {
		const {ledger, tool, handler} = setup();
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'matches', matchedApproval: true}, cost: 0.01});
		await recordApproval(tool, 'deploy', {project: 'prod'}, '/repo');

		const event = {toolName: 'deploy', input: {project: 'prod'}} as unknown as ToolCallEvent;
		const result = await handler(event, toolCallContext('/elsewhere'));

		expect(result).toBeUndefined();
		expect(performReviewMock).toHaveBeenCalledOnce();
		expect(ledger.findPendingForTool('deploy', Date.now())).toBeUndefined();
	});

	it('spends the grant exactly once: an identical second retry goes to the reviewer', async () => {
		const {tool, handler} = setup();
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'deny', rationale: 'no live grant'}, cost: 0.01});
		await recordApproval(tool, 'deploy', {project: 'prod'}, '/repo');

		const event = {toolName: 'deploy', input: {project: 'prod'}} as unknown as ToolCallEvent;
		const first = await handler(event, toolCallContext('/repo'));
		const second = await handler(event, toolCallContext('/repo'));

		expect(first).toBeUndefined();
		expect(second).toMatchObject({block: true});
		expect(performReviewMock).toHaveBeenCalledOnce();
	});
});
