import type {
	ExtensionAPI,
	ExtensionContext,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import {approvalToolName} from './approval/approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {reviewOutput} from './review/output-reviewer.ts';
import {formatCost} from './review/run-review.ts';
import {appendReviewLog} from './review-log.ts';
import type {RuntimeState} from './runtime-state.ts';
import {joinPartsForReview} from './shared/content.ts';

type WithheldResult = {isError: true; content: Array<{type: 'text'; text: string}>};

export function createToolResultHandler(pi: ExtensionAPI, state: RuntimeState) {
	return async (event: ToolResultEvent, context: ExtensionContext): Promise<WithheldResult | undefined> => {
		if (!state.isReviewEnabled || event.toolName === approvalToolName) {
			return undefined;
		}

		const output = joinPartsForReview(event.content);
		if (output.trim() === '') {
			return undefined;
		}

		const config = await loadConfigFromPath(configPath);
		if (!config.ok) {
			appendReviewLog(pi, state, context, 'block', `Output review — withheld ${event.toolName}: configuration is invalid (${config.error}).`);
			return withheldResult(`configuration is invalid (${config.error})`);
		}

		if (!config.value.review.reviewOutput) {
			return undefined;
		}

		const review = await reviewOutput(context, config.value, event.toolName, output);
		state.sessionCost += review.cost;

		if (!review.ok) {
			appendReviewLog(pi, state, context, 'block', `Output review — withheld ${event.toolName}: could not inspect (${review.error}). Cost: ${formatCost(review.cost)}`);
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
			appendReviewLog(pi, state, context, 'block', `Output review — blocked ${event.toolName}: sensitive data detected${labels}: ${review.value.rationale} Cost: ${formatCost(review.cost)}`);
			context.abort();
			return {
				isError: true,
				content: [{
					type: 'text',
					text: `Agent Review blocked this tool output because it appears to contain sensitive information${labels}: ${review.value.rationale}
Execution has been stopped. Do not attempt to retrieve or transmit this data.`,
				}],
			};
		}

		appendReviewLog(pi, state, context, 'pass', `Output review — cleared ${event.toolName}: ${review.value.rationale} Cost: ${formatCost(review.cost)}`);
		return undefined;
	};
}

function withheldResult(reason: string): WithheldResult {
	return {
		isError: true,
		content: [{type: 'text', text: `Agent Review withheld this tool output because ${reason}. The output was not exposed.`}],
	};
}
