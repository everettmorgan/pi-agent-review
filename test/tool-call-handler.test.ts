import type {ExtensionAPI, ExtensionContext, ToolCallEvent} from '@earendil-works/pi-coding-agent';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {ApprovalLedger, approvalTtlMs} from '../src/approval/approval-ledger.ts';
import {approvalToolName} from '../src/approval/approval-tool.ts';
import type * as Config from '../src/config.ts';
import type {ReviewRequest} from '../src/review/normalize-tool-call.ts';
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

function makePi() {
	const appendEntry = vi.fn();
	return {pi: {appendEntry} as unknown as ExtensionAPI, appendEntry};
}

function makeContext() {
	const notify = vi.fn();
	const context = {
		cwd: '/repo',
		// eslint-disable-next-line @typescript-eslint/naming-convention
		hasUI: true,
		ui: {notify, confirm: vi.fn(), setWidget: vi.fn()},
		sessionManager: {getBranch: () => []},
	} as unknown as ExtensionContext;
	return {context, notify};
}

function makeEvent(toolName = 'bash', input?: unknown): ToolCallEvent {
	return {toolName, input: input ?? {command: 'npm test'}} as unknown as ToolCallEvent;
}

function grant(ledger: ApprovalLedger, event: ToolCallEvent, nonce = 'test-nonce', overrides: {inputJson?: string; cwd?: string} = {}): void {
	ledger.record({
		nonce,
		toolName: event.toolName,
		inputJson: overrides.inputJson ?? '{"command":"the approved command"}',
		cwd: overrides.cwd ?? '/repo',
		approvedAction: `Tool: ${event.toolName}`,
		expiresAt: Date.now() + approvalTtlMs,
	});
}

function isPending(ledger: ApprovalLedger, toolName: string): boolean {
	return ledger.findPendingForTool(toolName, Date.now()) !== undefined;
}

describe('createToolCallHandler', () => {
	beforeEach(async () => {
		performReviewMock.mockReset();
		loadConfigMock.mockReset();
		const {defaultConfig} = await vi.importActual<typeof Config>('../src/config.ts');
		loadConfigMock.mockResolvedValue({ok: true, value: defaultConfig});
	});

	it('skips review when disabled for the session', async () => {
		const state = createRuntimeState();
		state.isReviewEnabled = false;
		const handler = createToolCallHandler(makePi().pi, state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext().context);

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('skips review for the approval-request tool itself', async () => {
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi().pi, state, new ApprovalLedger());

		const result = await handler(makeEvent(approvalToolName, {toolName: 'bash', input: {}, reason: 'x'}), makeContext().context);

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('hard-denies secret paths without calling the reviewer', async () => {
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi().pi, state, new ApprovalLedger());

		const result = await handler(makeEvent('read', {path: '.env'}), makeContext().context);

		expect(result).toEqual({block: true, reason: expect.stringContaining('secret') as string});
		expect(performReviewMock).not.toHaveBeenCalled();
	});

	it('allows a reviewer-approved call, records the decision, and logs it', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'safe'}, cost: 0.01});
		const state = createRuntimeState();
		const {pi, appendEntry} = makePi();
		const handler = createToolCallHandler(pi, state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext().context);

		expect(result).toBeUndefined();
		expect(state.lastDecision).toMatchObject({decision: 'approve', toolName: 'bash'});
		const logged = appendEntry.mock.calls.find(([type]) => type === 'agent-review-log');
		expect((logged?.[1] as {message: string} | undefined)?.message).toContain('Approved: bash');
	});

	it('blocks a reviewer-denied call with request_user_approval guidance', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'deny', rationale: 'risky'}, cost: 0.01});
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi().pi, state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext().context);

		expect(result).toMatchObject({block: true});
		expect(result?.reason).toContain('request_user_approval');
		expect(state.lastDecision).toMatchObject({decision: 'deny'});
	});

	it('approves an exact user-approved call without the reviewer and consumes the grant', async () => {
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const {pi, appendEntry} = makePi();
		const event = makeEvent();
		grant(ledger, event, 'nonce-1', {inputJson: '{"command":"npm test"}'});
		const handler = createToolCallHandler(pi, state, ledger);

		const result = await handler(event, makeContext().context);

		expect(result).toBeUndefined();
		expect(performReviewMock).not.toHaveBeenCalled();
		expect(appendEntry).toHaveBeenCalledWith('agent-review-consumption', {nonce: 'nonce-1'});
		expect(isPending(ledger, 'bash')).toBe(false);
		expect(state.lastDecision).toMatchObject({decision: 'approve', cost: 0});
	});

	it('consumes a ledger approval when the reviewer reports the call matched it', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'user approved', matchedApproval: true}, cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const {pi, appendEntry} = makePi();
		const event = makeEvent();
		grant(ledger, event, 'nonce-1');
		const handler = createToolCallHandler(pi, state, ledger);

		await handler(event, makeContext().context);

		const request = performReviewMock.mock.calls[0]?.[2] as ReviewRequest;
		expect(request.approval).toEqual({status: 'approved_by_user', approvedAction: 'Tool: bash'});
		expect(appendEntry).toHaveBeenCalledWith('agent-review-consumption', {nonce: 'nonce-1'});
		expect(isPending(ledger, 'bash')).toBe(false);
	});

	it('does not burn the grant when the reviewer explicitly reports the call as unrelated', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'routine read', matchedApproval: false}, cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const {pi, appendEntry} = makePi();
		const event = makeEvent();
		grant(ledger, event, 'nonce-1');
		const handler = createToolCallHandler(pi, state, ledger);

		const result = await handler(event, makeContext().context);

		expect(result).toBeUndefined();
		expect(appendEntry).not.toHaveBeenCalledWith('agent-review-consumption', expect.anything());
		expect(isPending(ledger, 'bash')).toBe(true);
	});

	it('consumes the grant when the reviewer approves without reporting matchedApproval', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'approve', rationale: 'fine'}, cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const {pi, appendEntry} = makePi();
		const event = makeEvent();
		grant(ledger, event, 'nonce-1');
		const handler = createToolCallHandler(pi, state, ledger);

		await handler(event, makeContext().context);

		expect(appendEntry).toHaveBeenCalledWith('agent-review-consumption', {nonce: 'nonce-1'});
		expect(isPending(ledger, 'bash')).toBe(false);
	});

	it('hard-denies a secret path even when an exact user-approved grant matches it', async () => {
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const event = makeEvent('read', {path: '.env'});
		grant(ledger, event, 'nonce-1', {inputJson: '{"path":".env"}'});
		const handler = createToolCallHandler(makePi().pi, state, ledger);

		const result = await handler(event, makeContext().context);

		expect(result).toEqual({block: true, reason: expect.stringContaining('secret') as string});
		expect(performReviewMock).not.toHaveBeenCalled();
		expect(isPending(ledger, 'read')).toBe(true);
	});

	it('blocks on reviewer failure', async () => {
		performReviewMock.mockResolvedValue({ok: false, error: 'timeout', cost: 0});
		const state = createRuntimeState();
		const handler = createToolCallHandler(makePi().pi, state, new ApprovalLedger());

		const result = await handler(makeEvent(), makeContext().context);

		expect(result).toMatchObject({block: true});
		expect(result?.reason).toContain('reviewer approval failed');
		expect(state.lastDecision).toMatchObject({decision: 'failure'});
	});

	it('does not burn a one-shot approval when the reviewer fails transiently', async () => {
		performReviewMock.mockResolvedValue({ok: false, error: 'timeout', cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const {pi, appendEntry} = makePi();
		const event = makeEvent();
		grant(ledger, event);
		const handler = createToolCallHandler(pi, state, ledger);

		await handler(event, makeContext().context);

		expect(isPending(ledger, 'bash')).toBe(true);
		expect(appendEntry).not.toHaveBeenCalledWith('agent-review-consumption', expect.anything());
	});

	it('does not burn a one-shot approval when the reviewer denies', async () => {
		performReviewMock.mockResolvedValue({ok: true, value: {decision: 'deny', rationale: 'still risky'}, cost: 0});
		const state = createRuntimeState();
		const ledger = new ApprovalLedger();
		const event = makeEvent();
		grant(ledger, event);
		const handler = createToolCallHandler(makePi().pi, state, ledger);

		await handler(event, makeContext().context);

		expect(isPending(ledger, 'bash')).toBe(true);
	});
});
