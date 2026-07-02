import {extractText, unwrapMessage} from './branch-messages.ts';
import {neutralizeFence, truncateText} from './normalize-tool-call.ts';

export type TranscriptOptions = {
	maxEntries: number;
	maxChars: number;
};

type SessionManagerLike = {
	getBranch(): unknown[];
};

function formatEntry(entry: unknown): string | undefined {
	const message = unwrapMessage(entry);
	if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
		return undefined;
	}

	const text = extractText(message.content, {includeToolCalls: true});
	if (text.trim() === '') {
		return undefined;
	}

	return `${message.role}: ${text}`;
}

export function compactTranscript(sessionManager: SessionManagerLike, options: TranscriptOptions): string {
	const branch = sessionManager.getBranch();
	const formatted = branch
		.slice(-options.maxEntries)
		.map(entry => formatEntry(entry))
		.filter((entry): entry is string => entry !== undefined)
		.join('\n\n');
	return neutralizeFence(truncateText(formatted, options.maxChars));
}
