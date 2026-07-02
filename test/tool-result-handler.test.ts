import type {ExtensionAPI, ExtensionContext, ToolResultEvent} from '@earendil-works/pi-coding-agent';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type * as Config from '../src/config.ts';
import {reviewLogEntryType} from '../src/review-log.ts';
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

function makePi() {
	const appendEntry = vi.fn();
	return {pi: {appendEntry} as unknown as ExtensionAPI, appendEntry};
}

function makeContext() {
	const abort = vi.fn();
	const context = {
		cwd: '/repo',
		abort,
		sessionManager: {getBranch: () => []},
	} as unknown as ExtensionContext;
	return {context, abort};
}

function lastLog(appendEntry: ReturnType<typeof vi.fn>): string | undefined {
	const call = appendEntry.mock.calls.find(([type]) => type === reviewLogEntryType);
	return (call?.[1] as {message: string} | undefined)?.message;
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

	it('passes clean output through, records the assessment, and logs it', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: false, rationale: 'no secrets', categories: []}, cost: 0.01});
		const state = createRuntimeState();
		const {pi, appendEntry} = makePi();
		const {context, abort} = makeContext();

		const result = await createToolResultHandler(pi, state)(makeEvent('ordinary file contents'), context);

		expect(result).toBeUndefined();
		expect(abort).not.toHaveBeenCalled();
		expect(state.sessionCost).toBe(0.01);
		expect(state.lastOutputReview).toMatchObject({toolName: 'read', containsSensitive: false, rationale: 'no secrets'});
		expect(lastLog(appendEntry)).toContain('Output review — cleared read');
	});

	it('blocks, logs, and stops when a leak is detected', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: true, rationale: 'AWS secret key present.', categories: ['aws-key']}, cost: 0.02});
		const state = createRuntimeState();
		const {pi, appendEntry} = makePi();
		const {context, abort} = makeContext();

		const result = await createToolResultHandler(pi, state)(makeEvent('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexamplekey'), context);

		expect(result?.isError).toBe(true);
		expect(result?.content[0].text).toContain('sensitive information');
		expect(abort).toHaveBeenCalledOnce();
		expect(lastLog(appendEntry)).toContain('aws-key');
		expect(state.lastOutputReview).toMatchObject({containsSensitive: true, categories: ['aws-key']});
	});

	it('withholds output and does not stop the turn when the reviewer fails', async () => {
		reviewOutputMock.mockResolvedValue({ok: false, error: 'timeout', cost: 0});
		const state = createRuntimeState();
		const {pi, appendEntry} = makePi();
		const {context, abort} = makeContext();

		const result = await createToolResultHandler(pi, state)(makeEvent('some output'), context);

		expect(result?.isError).toBe(true);
		expect(result?.content[0].text).toContain('withheld');
		expect(abort).not.toHaveBeenCalled();
		expect(lastLog(appendEntry)).toContain('could not inspect');
	});

	it('skips review when the session has review disabled', async () => {
		const state = createRuntimeState();
		state.reviewState = {isReviewEnabled: false};

		const result = await createToolResultHandler(makePi().pi, state)(makeEvent('anything'), makeContext().context);

		expect(result).toBeUndefined();
		expect(reviewOutputMock).not.toHaveBeenCalled();
	});

	it('skips error results and empty output', async () => {
		const state = createRuntimeState();
		const {pi} = makePi();

		await createToolResultHandler(pi, state)(makeEvent('boom', {isError: true}), makeContext().context);
		await createToolResultHandler(pi, state)(makeEvent(' '.repeat(3)), makeContext().context);

		expect(reviewOutputMock).not.toHaveBeenCalled();
	});
});
