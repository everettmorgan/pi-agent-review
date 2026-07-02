import type {
	ExtensionContext,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import {approvalToolName} from './approval/approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {reviewOutput} from './review/output-reviewer.ts';
import {formatCost} from './review/run-review.ts';
import type {RuntimeState} from './runtime-state.ts';
import {joinTextParts} from './shared/content.ts';

// After a tool runs, inspect its output for sensitive data. A confirmed leak is
// blocked (the content is withheld from the model and transcript), flagged to
// the user, and the turn is aborted. Because the tool already executed, we fail
// closed the same way the call path does: if the reviewer itself cannot run, the
// unreviewed output is withheld rather than passed through.
type WithheldResult = {isError: true; content: Array<{type: 'text'; text: string}>};

export function createToolResultHandler(state: RuntimeState) {
	return async (event: ToolResultEvent, context: ExtensionContext): Promise<WithheldResult | undefined> => {
		if (!state.reviewState.isReviewEnabled || event.toolName === approvalToolName || event.isError) {
			return undefined;
		}

		const output = joinTextParts(event.content);
		if (output.trim() === '') {
			return undefined;
		}

		const config = await loadConfigFromPath(configPath);
		if (!config.ok) {
			return withheldResult(`configuration is invalid (${config.error})`);
		}

		const review = await reviewOutput(context, config.value, event.toolName, output);
		state.sessionCost += review.cost;

		if (!review.ok) {
			context.ui.notify(`Agent Review could not inspect ${event.toolName} output: ${review.error}`, 'error');
			return withheldResult(`it could not be inspected (${review.error})`);
		}

		state.lastOutputReview = {
			toolName: event.toolName,
			containsSensitive: review.value.containsSensitive,
			rationale: review.value.rationale,
			categories: review.value.categories,
			cost: review.cost,
		};

		const labels = review.value.categories.length > 0 ? ` [${review.value.categories.join(', ')}]` : '';

		if (review.value.containsSensitive) {
			context.ui.notify(`Output review — blocked ${event.toolName}: sensitive data detected${labels}: ${review.value.rationale} Cost: ${formatCost(review.cost)}`, 'error');
			context.abort();
			return {
				isError: true,
				content: [{type: 'text', text: `Agent Review blocked this tool output because it appears to contain sensitive information${labels}: ${review.value.rationale} Execution has been stopped. Do not attempt to retrieve or transmit this data.`}],
			};
		}

		context.ui.notify(`Output review — cleared ${event.toolName}: ${review.value.rationale} Cost: ${formatCost(review.cost)}`, 'info');
		return undefined;
	};
}

function withheldResult(reason: string): WithheldResult {
	return {
		isError: true,
		content: [{type: 'text', text: `Agent Review withheld this tool output because ${reason}. The output was not exposed.`}],
	};
}
