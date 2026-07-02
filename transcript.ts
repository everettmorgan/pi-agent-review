import {neutralizeFence, truncateText} from './normalize-tool-call.ts';

export type TranscriptOptions = {
	maxEntries: number;
	maxChars: number;
};

type ContentPart = {
	type: string;
	text?: string;
};

type MessageLike = {
	role?: string;
	content?: string | ContentPart[];
};

type BranchEntry = MessageLike | {
	type?: string;
	message?: MessageLike;
};

type SessionManagerLike = {
	getBranch(): unknown[];
};

function extractText(content: string | ContentPart[] | undefined): string {
	if (typeof content === 'string') {
		return content;
	}

	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.map(part => {
			if (part.type === 'text' && typeof part.text === 'string') {
				return part.text;
			}

			if (part.type === 'toolCall') {
				return `[tool call] ${JSON.stringify(part)}`;
			}

			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function unwrapMessage(entry: BranchEntry): MessageLike {
	if ('message' in entry && entry.type === 'message' && entry.message !== undefined) {
		return entry.message;
	}

	return entry as MessageLike;
}

function formatEntry(entry: BranchEntry): string | undefined {
	const message = unwrapMessage(entry);
	if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
		return undefined;
	}

	const text = extractText(message.content);
	if (text.trim() === '') {
		return undefined;
	}

	return `${message.role}: ${text}`;
}

export function compactTranscript(sessionManager: SessionManagerLike, options: TranscriptOptions): string {
	const branch = sessionManager.getBranch();
	const formatted = branch
		.slice(-options.maxEntries)
		.map(entry => formatEntry(entry as BranchEntry))
		.filter((entry): entry is string => entry !== undefined)
		.join('\n\n');
	return neutralizeFence(truncateText(formatted, options.maxChars));
}
