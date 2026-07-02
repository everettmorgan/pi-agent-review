import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ApprovalLedger, computeArgsHash} from '../approval-ledger.ts';
import {approvalToolName} from '../approval-tool.ts';
import {createRuntimeState} from '../runtime-state.ts';
import {createToolCallHandler} from '../tool-call-handler.ts';

const {performReviewMock} = vi.hoisted(() => ({performReviewMock: vi.fn()}));

vi.mock('../run-review.ts', async importOriginal => ({
	...(await importOriginal<typeof import('../run-review.ts')>()),
	performReview: performReviewMock,
}));

function makePi() {
	return {appendEntry: vi.fn()} as any;
}

function makeContext() {
	return {
		cwd: '/repo',
		hasUI: true,
		ui: {notify: vi.fn(), confirm: vi.fn()},
		sessionManager: {getBranch: () => []},
	} as any;
}

function makeEvent(toolName = 'bash', input: unknown = {command: 'npm test'}) {
	return {toolName, input} as any;
}

describe('createToolCallHandler', () => {
	beforeEach(() => {
		performReviewMock.mockReset();
	});

	it('skips review when disabled for the session', async () => {
		const state = createRuntimeState();
		state.reviewState = {isReviewEnabled: false};
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext());

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('skips review for the approval-request tool itself', async () => {
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent(approvalToolName, {toolName: 'bash', input: {}, reason: 'x'}), makeContext());

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('hard-denies secret paths without calling the reviewer', async () => {
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent('read', {path: '.env'}), makeContext());

		expect(result).toEqual({block: true, reason: expect.stringContaining('secret')});
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('allows a reviewer-approved call and records the decision', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'safe'}, cost: 0.01});
		const state = createRuntimeState();
		const context = makeContext();
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent(), context);

		expect(result).toBeUndefined();
		expect(state.lastDecision).toMatchObject({decision: 'approve', toolName: 'bash'});
		expect(context.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Approved: bash'), 'info');
	});

	it('blocks a reviewer-denied call with request_user_approval guidance', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'deny', rationale: 'risky'}, cost: 0.01});
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext());

		expect(result).toMatchObject({block: true});
		expect(result?.reason).toContain('request_user_approval');
		expect(state.lastDecision).toMatchObject({decision: 'deny'});
	});

	it('consumes a ledger approval and passes it to the reviewer', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'user approved'}, cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const pi = makePi();
		const event = makeEvent();
		const argsHash = computeArgsHash(event.toolName, event.input, '/repo');
		ledger.record({argsHash});
		const handler = createToolCallHandler(pi, state, ledger);

		await handler(event, makeContext());

		const request = performReviewMock.mock.calls[0]?.[2];
		expect(request.approval).toEqual({status: 'approved_by_user', argsHash});
		expect(pi.appendEntry).toHaveBeenCalledWith('agent-review-consumption', {argsHash});
		expect(ledger.hasPending(argsHash)).toBe(false);
	});

	it('blocks on reviewer failure', async () => {
		performReviewMock.mockResolvedValue({ok: false, error: 'timeout', cost: 0});
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi(), state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext());

		expect(result).toMatchObject({block: true});
		expect(result?.reason).toContain('reviewer approval failed');
		expect(state.lastDecision).toMatchObject({decision: 'failure'});
	});
});
