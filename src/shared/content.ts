type TextPartLike = {type: string; text?: string};

// Join the text of an array of content parts, ignoring non-text parts (images,
// tool calls). Used for model responses and tool results.
export function joinTextParts(parts: readonly TextPartLike[]): string {
	return parts
		.filter((part): part is {type: 'text'; text: string} => part.type === 'text' && typeof part.text === 'string')
		.map(part => part.text)
		.join('\n');
}
