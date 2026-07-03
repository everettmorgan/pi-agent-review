import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Text} from '@earendil-works/pi-tui';

export const reviewLogEntryType = 'agent-review-log';

export type ReviewLogData = {
	message: string;
};

export function registerReviewLog(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<ReviewLogData>(reviewLogEntryType, message => new Text(message.details?.message ?? ''));
}

export function appendReviewLog(pi: ExtensionAPI, message: string): void {
	pi.appendEntry<ReviewLogData>(reviewLogEntryType, {message});
}
