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
	const setStatus = vi.fn();
	const context = {
		cwd: '/repo',
		abort,
		// eslint-disable-next-line @typescript-eslint/naming-convention
		hasUI: true,
		ui: {setStatus},
		sessionManager: {getBranch: () => []},
	} as unknown as ExtensionContext;
	return {context, abort, setStatus};
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
		loadConfigMock.mockResolvedValue({ok: true, value: {reviewer: {}, review: {reviewOutput: true}}});
	});

	it('passes clean output through, records the assessment, logs it, and updates the footer tally', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: false, rationale: 'no secrets', categories: []}, cost: 0.01});
		const state = createRuntimeState();
		const {pi, appendEntry} = makePi();
		const {context, abort, setStatus} = makeContext();

		const result = await createToolResultHandler(pi, state)(makeEvent('ordinary file contents'), context);

		expect(result).toBeUndefined();
		expect(abort).not.toHaveBeenCalled();
		expect(state.sessionCost).toBe(0.01);
		expect(state.lastOutputReview).toMatchObject({toolName: 'read', containsSensitive: false, rationale: 'no secrets'});
		expect(lastLog(appendEntry)).toContain('Output review — cleared read');
		expect(setStatus).toHaveBeenCalledWith('agent-review', 'review ✓1 ✗0 $0.01');
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

	it('skips review when output review is turned off in config', async () => {
		loadConfigMock.mockResolvedValue({ok: true, value: {reviewer: {}, review: {reviewOutput: false}}});
		const state = createRuntimeState();

		const result = await createToolResultHandler(makePi().pi, state)(makeEvent('anything'), makeContext().context);

		expect(result).toBeUndefined();
		expect(reviewOutputMock).not.toHaveBeenCalled();
	});

	it('skips review when disabled for the session', async () => {
		const state = createRuntimeState();
		state.isReviewEnabled = false;

		const result = await createToolResultHandler(makePi().pi, state)(makeEvent('anything'), makeContext().context);

		expect(result).toBeUndefined();
		expect(reviewOutputMock).not.toHaveBeenCalled();
	});

	it('skips empty output', async () => {
		const state = createRuntimeState();

		await createToolResultHandler(makePi().pi, state)(makeEvent(' '.repeat(3)), makeContext().context);

		expect(reviewOutputMock).not.toHaveBeenCalled();
	});

	it('reviews error results too, since they still reach the model', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: true, rationale: 'secret in stderr', categories: ['aws-key']}, cost: 0.01});
		const state = createRuntimeState();
		const {context, abort} = makeContext();

		const result = await createToolResultHandler(makePi().pi, state)(makeEvent('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexamplekey', {isError: true}), context);

		expect(result?.isError).toBe(true);
		expect(abort).toHaveBeenCalledOnce();
	});

	it('includes non-text content parts in the reviewed output', async () => {
		reviewOutputMock.mockResolvedValue({ok: true, value: {containsSensitive: false, rationale: 'clean', categories: []}, cost: 0});
		const state = createRuntimeState();
		const event = makeEvent('visible text', {
			content: [
				{type: 'text', text: 'visible text'},
				{type: 'json', data: {token: 'sk-live-1234'}},
			],
		} as never);

		await createToolResultHandler(makePi().pi, state)(event, makeContext().context);

		const reviewed = reviewOutputMock.mock.calls[0]?.[3] as string;
		expect(reviewed).toContain('visible text');
		expect(reviewed).toContain('sk-live-1234');
	});
});
