import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import {classifyToolCall} from './approval-gate.ts';
import {
	computeArgsHash,
	consumptionEntryType,
	type ApprovalLedger,
} from './approval-ledger.ts';
import {approvalToolName} from './approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {normalizeToolCall} from './normalize-tool-call.ts';
import {formatDenialReason, formatReviewerFailureReason} from './review-decision.ts';
import {formatCost, formatOutcome, performReview} from './run-review.ts';
import type {RuntimeState} from './runtime-state.ts';

export function createToolCallHandler(pi: ExtensionAPI, state: RuntimeState, ledger: ApprovalLedger) {
	return async (event: ToolCallEvent, context: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		const configResult = await loadConfigFromPath(configPath);
		if (!configResult.ok) {
			state.lastDecision = undefined;
			return {block: true, reason: formatReviewerFailureReason(configResult.error)};
		}

		if (!state.reviewState.isReviewEnabled || event.toolName === approvalToolName) {
			state.lastDecision = undefined;
			return undefined;
		}

		const request = normalizeToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd});
		const argsHash = computeArgsHash(event.toolName, event.input, context.cwd);
		const gateResult = classifyToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd});

		if (gateResult.action === 'deny') {
			state.lastDecision = undefined;
			return {block: true, reason: `Agent Review blocked this tool call: ${gateResult.reason}`};
		}

		const approvalState = ledger.consume(argsHash)
			? {status: 'approved_by_user' as const, argsHash}
			: undefined;
		if (approvalState !== undefined) {
			pi.appendEntry(consumptionEntryType, {argsHash});
		}

		const normalizedRequest = approvalState === undefined
			? request
			: normalizeToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd}, {approval: approvalState, argsHash});
		const review = await performReview(context, configResult.value, normalizedRequest);

		state.sessionCost += review.cost;

		if (!review.ok) {
			state.lastDecision = {
				toolName: event.toolName, decision: 'failure', rationale: review.error, cost: review.cost,
			};
			const circuit = state.tracker.recordDenied();
			context.ui.notify(formatOutcome('Failed', event.toolName, review.error, review.cost), 'error');
			return {block: true, reason: circuit.tripped ? `${formatReviewerFailureReason(review.error)} ${circuit.reason ?? ''}` : `${formatReviewerFailureReason(review.error)} Review cost: ${formatCost(review.cost)}.`};
		}

		if (review.value.decision === 'deny') {
			state.lastDecision = {
				toolName: event.toolName,
				decision: 'deny',
				rationale: review.value.rationale,
				cost: review.cost,
				...((review.value.saferAlternative !== undefined) && {saferAlternative: review.value.saferAlternative}),
			};
			const circuit = state.tracker.recordDenied();
			const base = formatDenialReason(review.value);
			context.ui.notify(formatOutcome('Denied', event.toolName, review.value.rationale, review.cost, review.value.saferAlternative), 'warning');
			return {block: true, reason: circuit.tripped ? `${base} ${circuit.reason ?? ''}` : `${base} Review cost: ${formatCost(review.cost)}.`};
		}

		state.tracker.recordApproved();
		state.lastDecision = {
			toolName: event.toolName, decision: 'approve', rationale: review.value.rationale, cost: review.cost,
		};
		context.ui.notify(formatOutcome('Approved', event.toolName, review.value.rationale, review.cost), 'info');
		return undefined;
	};
}
