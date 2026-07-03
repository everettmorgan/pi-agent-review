import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import {stringify} from 'safe-stable-stringify';
import {classifyToolCall} from './approval/approval-gate.ts';
import {
	consumptionEntryType,
	type ApprovalLedger,
	type PendingApproval,
} from './approval/approval-ledger.ts';
import {approvalToolName} from './approval/approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {normalizeToolCall} from './review/normalize-tool-call.ts';
import {formatDenialReason, formatReviewerFailureReason, type ReviewDecision} from './review/review-decision.ts';
import type {ReviewerResult} from './review/reviewer.ts';
import {formatCost, formatOutcome, performReview} from './review/run-review.ts';
import {appendReviewLog} from './review-log.ts';
import type {RuntimeState} from './runtime-state.ts';

type Deps = {pi: ExtensionAPI; state: RuntimeState; ledger: ApprovalLedger; context: ExtensionContext};

function recordDenialAndBlock(state: RuntimeState, base: string, cost: number): ToolCallEventResult {
	const circuit = state.tracker.recordDenied();
	const suffix = circuit.tripped ? (circuit.reason ?? '') : `Review cost: ${formatCost(cost)}.`;
	return {block: true, reason: `${base} ${suffix}`};
}

function onFailure(deps: Deps, toolName: string, error: string, cost: number): ToolCallEventResult {
	deps.state.lastDecision = {
		toolName, decision: 'failure', rationale: error, cost,
	};
	appendReviewLog(deps.pi, deps.state, deps.context, formatOutcome('Failed', toolName, error, cost));
	return recordDenialAndBlock(deps.state, formatReviewerFailureReason(error), cost);
}

function onDeny(deps: Deps, toolName: string, decision: ReviewDecision, cost: number): ToolCallEventResult {
	deps.state.lastDecision = {
		toolName,
		decision: 'deny',
		rationale: decision.rationale,
		cost,
		...((decision.saferAlternative !== undefined) && {saferAlternative: decision.saferAlternative}),
	};
	appendReviewLog(deps.pi, deps.state, deps.context, formatOutcome('Denied', toolName, decision.rationale, cost, decision.saferAlternative));
	return recordDenialAndBlock(deps.state, formatDenialReason(decision), cost);
}

function consumeGrant(deps: Deps, approval: PendingApproval): void {
	deps.ledger.consume(approval.nonce);
	deps.pi.appendEntry(consumptionEntryType, {nonce: approval.nonce});
}

function onApprove(deps: Deps, toolName: string, approval: PendingApproval | undefined, decision: ReviewDecision, cost: number): void {
	if (approval !== undefined && decision.matchedApproval !== false) {
		consumeGrant(deps, approval);
	}

	deps.state.tracker.recordApproved();
	deps.state.lastDecision = {
		toolName, decision: 'approve', rationale: decision.rationale, cost,
	};
	appendReviewLog(deps.pi, deps.state, deps.context, formatOutcome('Approved', toolName, decision.rationale, cost));
}

function onExactApproval(deps: Deps, toolName: string, approval: PendingApproval): void {
	consumeGrant(deps, approval);
	deps.state.tracker.recordApproved();
	const rationale = 'Exactly matches an action the user approved.';
	deps.state.lastDecision = {
		toolName, decision: 'approve', rationale, cost: 0,
	};
	appendReviewLog(deps.pi, deps.state, deps.context, formatOutcome('Approved', toolName, rationale, 0));
}

export function createToolCallHandler(pi: ExtensionAPI, state: RuntimeState, ledger: ApprovalLedger) {
	return async (event: ToolCallEvent, context: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		if (!state.isReviewEnabled || event.toolName === approvalToolName) {
			state.lastDecision = undefined;
			return undefined;
		}

		const configResult = await loadConfigFromPath(configPath);
		if (!configResult.ok) {
			state.lastDecision = undefined;
			return {block: true, reason: formatReviewerFailureReason(configResult.error)};
		}

		if (!configResult.value.review.reviewInput) {
			state.lastDecision = undefined;
			return undefined;
		}

		const deps: Deps = {
			pi, state, ledger, context,
		};
		const call = {toolName: event.toolName, input: event.input, cwd: context.cwd};
		const gateResult = classifyToolCall(call);
		if (gateResult.action === 'deny') {
			state.lastDecision = undefined;
			return {block: true, reason: `Agent Review blocked this tool call: ${gateResult.reason}`};
		}

		const exactApproval = ledger.findExactMatch(event.toolName, stringify(event.input), context.cwd, Date.now());
		if (exactApproval !== undefined) {
			onExactApproval(deps, event.toolName, exactApproval);
			return undefined;
		}

		const approval = ledger.findPendingForTool(event.toolName, Date.now());
		const approvalState = approval === undefined ? undefined : {status: 'approved_by_user' as const, approvedAction: approval.approvedAction};
		const review = await performReview(context, configResult.value, normalizeToolCall(call, approvalState));
		state.sessionCost += review.cost;
		return dispatchOutcome(deps, event.toolName, approval, review);
	};
}

function dispatchOutcome(deps: Deps, toolName: string, approval: PendingApproval | undefined, review: ReviewerResult): ToolCallEventResult | undefined {
	if (!review.ok) {
		return onFailure(deps, toolName, review.error, review.cost);
	}

	if (review.value.decision === 'deny') {
		return onDeny(deps, toolName, review.value, review.cost);
	}

	onApprove(deps, toolName, approval, review.value, review.cost);
	return undefined;
}
