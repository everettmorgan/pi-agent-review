import {isRecord} from './guards.ts';

export type MessageLike = {
	role?: unknown;
	toolName?: unknown;
	content?: unknown;
};

export function unwrapMessage(entry: unknown): MessageLike {
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

export function extractText(content: unknown, options: {includeToolCalls?: boolean} = {}): string {
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

			if (part.type === 'text' && typeof part.text === 'string') {
				return part.text;
			}

			if (options.includeToolCalls === true && part.type === 'toolCall') {
				return `[tool call] ${JSON.stringify(part)}`;
			}

			return '';
		})
		.filter(Boolean)
		.join('\n');
}
