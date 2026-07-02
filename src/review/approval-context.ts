import {extractText, unwrapMessage} from '../shared/branch-messages.ts';
import {neutralizeFence, truncateText} from './normalize-tool-call.ts';

export type TrustedIntentContext = {
	recentUserMessages: string[];
	structuredUserAnswers: string[];
};

export type TrustedIntentOptions = {
	maxItems: number;
	maxCharsPerItem: number;
};

const defaultOptions: TrustedIntentOptions = {
	maxItems: 8,
	maxCharsPerItem: 1000,
};

function cleanTrustedText(text: string, maxChars: number): string {
	return truncateText(neutralizeFence(text.trim()), maxChars);
}

export function buildTrustedIntentContext(branch: unknown[], options: Partial<TrustedIntentOptions> = {}): TrustedIntentContext {
	const resolvedOptions = {...defaultOptions, ...options};
	const recentUserMessages: string[] = [];
	const structuredUserAnswers: string[] = [];

	for (let index = branch.length - 1; index >= 0; index--) {
		if (recentUserMessages.length + structuredUserAnswers.length >= resolvedOptions.maxItems) {
			break;
		}

		const message = unwrapMessage(branch[index]);
		const text = extractText(message.content);
		if (text.trim() === '') {
			continue;
		}

		if (message.role === 'user') {
			recentUserMessages.unshift(cleanTrustedText(text, resolvedOptions.maxCharsPerItem));
			continue;
		}

		if (message.role === 'toolResult' && message.toolName === 'ask_user_question') {
			structuredUserAnswers.unshift(cleanTrustedText(text, resolvedOptions.maxCharsPerItem));
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
