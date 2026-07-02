const openaiStyleToolChoice: ReadonlySet<string> = new Set([
	'openai-completions',
	'openai-responses',
	'azure-openai-responses',
	'openai-codex-responses',
	'mistral-conversations',
]);

const anyStyleToolChoice: ReadonlySet<string> = new Set([
	'anthropic-messages',
	'google-generative-ai',
	'google-vertex',
	'bedrock-converse-stream',
]);

export const toolSupportingApis: ReadonlySet<string> = new Set([...openaiStyleToolChoice, ...anyStyleToolChoice]);

export function isModelSupportingTools(model: {api?: string}): boolean {
	return typeof model.api === 'string' && toolSupportingApis.has(model.api);
}

export function forcedToolChoice(model: {api?: string}): string | undefined {
	if (typeof model.api !== 'string') {
		return undefined;
	}

	if (openaiStyleToolChoice.has(model.api)) {
		return 'required';
	}

	if (anyStyleToolChoice.has(model.api)) {
		return 'any';
	}

	return undefined;
}
