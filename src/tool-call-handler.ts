import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
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
import {formatCost, formatOutcome, performReview} from './review/run-review.ts';
import {appendReviewLog} from './review-log.ts';
import type {RuntimeState} from './runtime-state.ts';

type Deps = {pi: ExtensionAPI; state: RuntimeState; ledger: ApprovalLedger};

// Record a denial against the circuit breaker and build the block result,
// appending either the tripped-breaker reason or the review cost.
function recordDenialAndBlock(state: RuntimeState, base: string, cost: number): ToolCallEventResult {
	const circuit = state.tracker.recordDenied();
	const suffix = circuit.tripped ? (circuit.reason ?? '') : `Review cost: ${formatCost(cost)}.`;
	return {block: true, reason: `${base} ${suffix}`};
}

function onFailure(deps: Deps, toolName: string, error: string, cost: number): ToolCallEventResult {
	deps.state.lastDecision = {
		toolName, decision: 'failure', rationale: error, cost,
	};
	appendReviewLog(deps.pi, formatOutcome('Failed', toolName, error, cost));
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
	appendReviewLog(deps.pi, formatOutcome('Denied', toolName, decision.rationale, cost, decision.saferAlternative));
	return recordDenialAndBlock(deps.state, formatDenialReason(decision), cost);
}

function onApprove(deps: Deps, toolName: string, approval: PendingApproval | undefined, decision: ReviewDecision, cost: number): void {
	if (approval !== undefined) {
		deps.ledger.consume(approval.nonce);
		deps.pi.appendEntry(consumptionEntryType, {nonce: approval.nonce});
	}

	deps.state.tracker.recordApproved();
	deps.state.lastDecision = {
		toolName, decision: 'approve', rationale: decision.rationale, cost,
	};
	appendReviewLog(deps.pi, formatOutcome('Approved', toolName, decision.rationale, cost));
}

export function createToolCallHandler(pi: ExtensionAPI, state: RuntimeState, ledger: ApprovalLedger) {
	const deps: Deps = {pi, state, ledger};
	return async (event: ToolCallEvent, context: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		// Checked before config load so a malformed config can't brick the off
		// switch or the request_user_approval escape hatch.
		if (!state.reviewState.isReviewEnabled || event.toolName === approvalToolName) {
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

		const call = {toolName: event.toolName, input: event.input, cwd: context.cwd};
		const gateResult = classifyToolCall(call);
		if (gateResult.action === 'deny') {
			state.lastDecision = undefined;
			return {block: true, reason: `Agent Review blocked this tool call: ${gateResult.reason}`};
		}

		// Peek without consuming so the grant survives a reviewer failure or
		// denial and the agent can retry. Consumed (by nonce) only on approve.
		const approval = ledger.findPendingForTool(event.toolName, Date.now());
		const approvalState = approval === undefined ? undefined : {status: 'approved_by_user' as const, approvedAction: approval.approvedAction};
		const review = await performReview(context, configResult.value, normalizeToolCall(call, approvalState === undefined ? {} : {approval: approvalState}));
		state.sessionCost += review.cost;

		if (!review.ok) {
			return onFailure(deps, event.toolName, review.error, review.cost);
		}

		if (review.value.decision === 'deny') {
			return onDeny(deps, event.toolName, review.value, review.cost);
		}

		onApprove(deps, event.toolName, approval, review.value, review.cost);
		return undefined;
	};
}
