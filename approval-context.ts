import { neutralizeFence, truncateText } from './normalize-tool-call.ts';

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

type MessageLike = {
	role?: unknown;
	toolName?: unknown;
	content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function unwrapMessage(entry: unknown): MessageLike {
	if (!isRecord(entry)) {
		return {};
	}

	if (entry.type === 'message' && isRecord(entry.message)) {
		return {
			role: entry.message.role,
			toolName: entry.message.toolName,
			content: entry.message.content,
		};
	}

	return {
		role: entry.role,
		toolName: entry.toolName,
		content: entry.content,
	};
}

function extractText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.map(part => {
			if (!isRecord(part)) {
				return '';
			}

			return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
		})
		.filter(Boolean)
		.join('\n');
}

function cleanTrustedText(text: string, maxChars: number): string {
	return truncateText(neutralizeFence(text.trim()), maxChars);
}

export function buildTrustedIntentContext(branch: unknown[], options: Partial<TrustedIntentOptions> = {}): TrustedIntentContext {
	const resolvedOptions = { ...defaultOptions, ...options };
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

	return { recentUserMessages, structuredUserAnswers };
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
