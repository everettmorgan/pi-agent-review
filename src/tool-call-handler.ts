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
} from './approval/approval-ledger.ts';
import {approvalToolName} from './approval/approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {normalizeToolCall} from './review/normalize-tool-call.ts';
import {formatDenialReason, formatReviewerFailureReason} from './review/review-decision.ts';
import {formatCost, formatOutcome, performReview} from './review/run-review.ts';
import {appendReviewLog} from './review-log.ts';
import type {RuntimeState} from './runtime-state.ts';

// Record a denial against the circuit breaker and build the block result,
// appending either the tripped-breaker reason or the review cost.
function recordDenialAndBlock(state: RuntimeState, base: string, cost: number): ToolCallEventResult {
	const circuit = state.tracker.recordDenied();
	const suffix = circuit.tripped ? (circuit.reason ?? '') : `Review cost: ${formatCost(cost)}.`;
	return {block: true, reason: `${base} ${suffix}`};
}

export function createToolCallHandler(pi: ExtensionAPI, state: RuntimeState, ledger: ApprovalLedger) {
	return async (event: ToolCallEvent, context: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		// The disabled-session and approval-tool paths must not depend on config
		// parsing: a malformed config should never brick /agent-review off or the
		// request_user_approval escape hatch that every denial message points to.
		if (!state.reviewState.isReviewEnabled || event.toolName === approvalToolName) {
			state.lastDecision = undefined;
			return undefined;
		}

		const configResult = await loadConfigFromPath(configPath);
		if (!configResult.ok) {
			state.lastDecision = undefined;
			return {block: true, reason: formatReviewerFailureReason(configResult.error)};
		}

		const call = {toolName: event.toolName, input: event.input, cwd: context.cwd};

		const gateResult = classifyToolCall(call);
		if (gateResult.action === 'deny') {
			state.lastDecision = undefined;
			return {block: true, reason: `Agent Review blocked this tool call: ${gateResult.reason}`};
		}

		// Peek at a live approval for this tool without consuming it: the grant
		// must survive a transient reviewer failure or a reviewer denial so the
		// agent can retry without re-prompting the user. The reviewer decides
		// whether this call matches the approved action; it is consumed (by nonce)
		// only once the reviewer terminally approves.
		const approval = ledger.findPendingForTool(event.toolName, Date.now());
		const approvalState = approval === undefined ? undefined : {status: 'approved_by_user' as const, approvedAction: approval.approvedAction};
		const normalizedRequest = normalizeToolCall(call, approvalState === undefined ? {} : {approval: approvalState});
		const review = await performReview(context, configResult.value, normalizedRequest);

		state.sessionCost += review.cost;

		if (!review.ok) {
			state.lastDecision = {
				toolName: event.toolName, decision: 'failure', rationale: review.error, cost: review.cost,
			};
			appendReviewLog(pi, formatOutcome('Failed', event.toolName, review.error, review.cost));
			return recordDenialAndBlock(state, formatReviewerFailureReason(review.error), review.cost);
		}

		if (review.value.decision === 'deny') {
			state.lastDecision = {
				toolName: event.toolName,
				decision: 'deny',
				rationale: review.value.rationale,
				cost: review.cost,
				...((review.value.saferAlternative !== undefined) && {saferAlternative: review.value.saferAlternative}),
			};
			appendReviewLog(pi, formatOutcome('Denied', event.toolName, review.value.rationale, review.cost, review.value.saferAlternative));
			return recordDenialAndBlock(state, formatDenialReason(review.value), review.cost);
		}

		if (approval !== undefined) {
			ledger.consume(approval.nonce);
			pi.appendEntry(consumptionEntryType, {nonce: approval.nonce});
		}

		state.tracker.recordApproved();
		state.lastDecision = {
			toolName: event.toolName, decision: 'approve', rationale: review.value.rationale, cost: review.cost,
		};
		appendReviewLog(pi, formatOutcome('Approved', event.toolName, review.value.rationale, review.cost));
		return undefined;
	};
}
