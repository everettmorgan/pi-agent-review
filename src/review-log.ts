import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Text} from '@earendil-works/pi-tui';

export const reviewLogEntryType = 'agent-review-log';

export type ReviewLogData = {
	message: string;
};

// Agent Review writes its assessments as append-only session entries rather than
// transient notifications: notifications overwrite one another, so with several
// (often parallel) tool calls in a turn the earlier verdicts are lost. Entries
// persist in the chat history and are not sent to the model, so every request
// and output review stays visible without polluting the agent's context.
export function registerReviewLog(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<ReviewLogData>(reviewLogEntryType, message => new Text(message.details?.message ?? ''));
}

export function appendReviewLog(pi: ExtensionAPI, message: string): void {
	pi.appendEntry<ReviewLogData>(reviewLogEntryType, {message});
}
