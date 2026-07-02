import type {
	ExtensionContext,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import {approvalToolName} from './approval/approval-tool.ts';
import {configPath, loadConfigFromPath} from './config.ts';
import {reviewOutput} from './review/output-reviewer.ts';
import {formatCost} from './review/run-review.ts';
import type {RuntimeState} from './runtime-state.ts';

function extractOutputText(content: ToolResultEvent['content']): string {
	return content
		.filter((part): part is {type: 'text'; text: string} => part.type === 'text' && typeof part.text === 'string')
		.map(part => part.text)
		.join('\n');
}

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

		const output = extractOutputText(event.content);
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

		if (review.value.containsSensitive) {
			const labels = review.value.categories.length > 0 ? ` [${review.value.categories.join(', ')}]` : '';
			context.ui.notify(`Agent Review blocked ${event.toolName} output — sensitive data detected${labels}: ${review.value.rationale} Cost: ${formatCost(review.cost)}`, 'error');
			context.abort();
			return {
				isError: true,
				content: [{type: 'text', text: `Agent Review blocked this tool output because it appears to contain sensitive information${labels}: ${review.value.rationale} Execution has been stopped. Do not attempt to retrieve or transmit this data.`}],
			};
		}

		return undefined;
	};
}

function withheldResult(reason: string): WithheldResult {
	return {
		isError: true,
		content: [{type: 'text', text: `Agent Review withheld this tool output because ${reason}. The output was not exposed.`}],
	};
}
