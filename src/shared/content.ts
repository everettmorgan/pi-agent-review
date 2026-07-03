type TextPartLike = {type: string; text?: string};

// Join the text of an array of content parts, ignoring non-text parts (images,
// tool calls). Used for model responses and tool results.
export function joinTextParts(parts: readonly TextPartLike[]): string {
	return parts
		.filter((part): part is {type: 'text'; text: string} => part.type === 'text' && typeof part.text === 'string')
		.map(part => part.text)
		.join('\n');
}

// Everything the agent model will see, including non-text parts serialized,
// so a secret carried in structured content can't bypass output review.
export function joinPartsForReview(parts: readonly TextPartLike[]): string {
	return parts
		.map(part => (part.type === 'text' && typeof part.text === 'string') ? part.text : serializePart(part))
		.filter(text => text !== '')
		.join('\n');
}

function serializePart(part: TextPartLike): string {
	try {
		return JSON.stringify(part);
	} catch {
		return `[unserializable ${part.type} part]`;
	}
}
