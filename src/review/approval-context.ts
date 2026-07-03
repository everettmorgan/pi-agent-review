import {extractText, unwrapMessage} from '../shared/branch-messages.ts';
import {neutralizeFence, truncateText} from './normalize-tool-call.ts';

export type TrustedIntentContext = {
	recentUserMessages: string[];
	structuredUserAnswers: string[];
};

const maxItems = 8;
const maxCharsPerItem = 1000;

function cleanTrustedText(text: string): string {
	return truncateText(neutralizeFence(text.trim()), maxCharsPerItem);
}

export function buildTrustedIntentContext(branch: unknown[]): TrustedIntentContext {
	const recentUserMessages: string[] = [];
	const structuredUserAnswers: string[] = [];

	for (let index = branch.length - 1; index >= 0; index--) {
		if (recentUserMessages.length + structuredUserAnswers.length >= maxItems) {
			break;
		}

		const message = unwrapMessage(branch[index]);
		const text = extractText(message.content);
		if (text.trim() === '') {
			continue;
		}

		if (message.role === 'user') {
			recentUserMessages.unshift(cleanTrustedText(text));
			continue;
		}

		if (message.role === 'toolResult' && message.toolName === 'ask_user_question') {
			structuredUserAnswers.unshift(cleanTrustedText(text));
		}
	}

	return {recentUserMessages, structuredUserAnswers};
}

export function formatTrustedIntentContext(context: TrustedIntentContext): string {
	const lines: string[] = [];

	if (context.recentUserMessages.length > 0) {
		lines.push('Trusted direct user messages:');
		for (const message of context.recentUserMessages) {
			lines.push(`- ${message}`);
		}
	}

	if (context.structuredUserAnswers.length > 0) {
		if (lines.length > 0) {
			lines.push('');
		}

		lines.push('Trusted structured user answers:');
		for (const answer of context.structuredUserAnswers) {
			lines.push(`- ${answer}`);
		}
	}

	return lines.length === 0 ? 'No recent trusted user intent was found.' : lines.join('\n');
}
