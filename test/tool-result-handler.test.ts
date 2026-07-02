import type {ExtensionContext, ToolResultEvent} from '@earendil-works/pi-coding-agent';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type * as Config from '../src/config.ts';
import {createRuntimeState} from '../src/runtime-state.ts';
import {createToolResultHandler} from '../src/tool-result-handler.ts';

const {reviewOutputMock, loadConfigMock} = vi.hoisted(() => ({
	reviewOutputMock: vi.fn(),
	loadConfigMock: vi.fn(),
}));

vi.mock('../src/review/output-reviewer.ts', () => ({reviewOutput: reviewOutputMock}));
vi.mock('../src/config.ts', async importOriginal => ({
	...(await importOriginal<typeof Config>()),
	loadConfigFromPath: loadConfigMock,
}));

function makeContext() {
	const notify = vi.fn();
	const abort = vi.fn();
	const context = {
		cwd: '/repo',
		ui: {notify},
		abort,
		sessionManager: {getBranch: () => []},
	} as unknown as ExtensionContext;
	return {context, notify, abort};
}

function makeEvent(text: string, overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
	return {
		toolName: 'read',
		isError: false,
		content: [{type: 'text', text}],
		...overrides,
	} as unknown as ToolResultEvent;
}

describe('createToolResultHandler', () => {
	beforeEach(() => {
		reviewOutputMock.mockReset();
		loadConfigMock.mockReset();
		loadConfigMock.mockResolvedValue({ok: true, value: {reviewer: {}, review: {}}});
	});

	it('passes clean output through, records the assessment, and shows it', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: false, rationale: 'no secrets', categories: []}, cost: 0.01});
		const state = createRuntimeState();
		const {context, notify, abort} = makeContext();

		const result = await createToolResultHandler(state)(makeEvent('ordinary file contents'), context);

		expect(result).toBeUndefined();
		expect(abort).not.toHaveBeenCalled();
		expect(state.sessionCost).toBe(0.01);
		expect(state.lastOutputReview).toMatchObject({toolName: 'read', containsSensitive: false, rationale: 'no secrets'});
		expect(notify).toHaveBeenCalledWith(expect.stringContaining('Output review — cleared read'), 'info');
	});

	it('blocks, flags, and stops when a leak is detected', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: true, rationale: 'AWS secret key present.', categories: ['aws-key']}, cost: 0.02});
		const state = createRuntimeState();
		const {context, notify, abort} = makeContext();

		const result = await createToolResultHandler(state)(makeEvent('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexamplekey'), context);

		expect(result?.isError).toBe(true);
		expect(result?.content[0].text).toContain('sensitive information');
		expect(abort).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining('aws-key'), 'error');
		expect(state.lastOutputReview).toMatchObject({containsSensitive: true, categories: ['aws-key']});
	});

	it('withholds output and does not stop the turn when the reviewer fails', async () => {
		reviewOutputMock.mockResolvedValue({ok: false, error: 'timeout', cost: 0});
		const state = createRuntimeState();
		const {context, abort} = makeContext();

		const result = await createToolResultHandler(state)(makeEvent('some output'), context);

		expect(result?.isError).toBe(true);
		expect(result?.content[0].text).toContain('withheld');
		expect(abort).not.toHaveBeenCalled();
	});

	it('skips review when the session has review disabled', async () => {
		const state = createRuntimeState();
		state.reviewState = {isReviewEnabled: false};

		const result = await createToolResultHandler(state)(makeEvent('anything'), makeContext().context);

		expect(result).toBeUndefined();
		expect(reviewOutputMock).not.toHaveBeenCalled();
	});

	it('skips error results and empty output', async () => {
		const state = createRuntimeState();

		await createToolResultHandler(state)(makeEvent('boom', {isError: true}), makeContext().context);
		await createToolResultHandler(state)(makeEvent(' '.repeat(3)), makeContext().context);

		expect(reviewOutputMock).not.toHaveBeenCalled();
	});
});
