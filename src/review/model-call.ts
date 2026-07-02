import {
	type Api,
	type Message,
	type Model,
	type Tool,
	type ToolCall,
} from '@earendil-works/pi-ai';
import {complete} from '@earendil-works/pi-ai/compat';
import type {AgentReviewConfig} from '../config.ts';
import {joinTextParts} from '../shared/content.ts';
import {errorMessage} from '../shared/guards.ts';
import {forcedToolChoice} from './tool-support.ts';

export type ReviewerContext = {
	model: Model<Api> | undefined;
	modelRegistry: {
		getApiKeyAndHeaders(model: Model<Api>): Promise<{ok: true; apiKey?: string; headers?: Record<string, string>} | {ok: false; error: string}>;
		find(provider: string, model: string): Model<Api> | undefined;
	};
	signal?: AbortSignal;
};

export type ParseResult<T> = {ok: true; value: T} | {ok: false; error: string};

export type ModelCallResult<T> = {ok: true; value: T; cost: number} | {ok: false; error: string; cost: number};

export type ModelCall<T> = {
	systemPrompt: string;
	messages: Message[];
	tool: Tool;
	parseToolArguments: (args: unknown) => ParseResult<T>;
	// Optional fallback when the model answers in prose instead of a tool call.
	parseTextFallback?: (text: string) => ParseResult<T>;
};

function reviewCost(response: {usage?: {cost?: {total?: number}}}): number {
	return response.usage?.cost?.total ?? 0;
}

export function extractTextResponse(response: {content: Array<{type: string; text?: string}>}): string {
	return joinTextParts(response.content).trim();
}

function selectModel(context: ReviewerContext, config: AgentReviewConfig): Model<Api> | undefined {
	if (config.reviewer.provider === 'current' && config.reviewer.model === 'current') {
		return context.model;
	}

	return context.modelRegistry.find(config.reviewer.provider, config.reviewer.model);
}

export function createTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): {signal: AbortSignal; cleanup: () => void} {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	const abortFromParent = () => {
		controller.abort();
	};

	if (parentSignal?.aborted === true) {
		controller.abort();
	} else {
		parentSignal?.addEventListener('abort', abortFromParent, {once: true});
	}

	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timeout);
			parentSignal?.removeEventListener('abort', abortFromParent);
		},
	};
}

// Shared plumbing for a single constrained reviewer-model call: resolve and
// authenticate the model, call it with one forced decision tool under a timeout,
// and parse the tool call (with an optional prose fallback). Callers supply the
// prompt, the tool, and how to validate the tool's arguments.
export async function callReviewModel<T>(context: ReviewerContext, config: AgentReviewConfig, call: ModelCall<T>): Promise<ModelCallResult<T>> {
	const model = selectModel(context, config);
	if (model === undefined) {
		return {ok: false, error: `Reviewer model ${config.reviewer.provider}/${config.reviewer.model} is unavailable.`, cost: 0};
	}

	const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		return {ok: false, error: `Reviewer auth failed: ${auth.error}`, cost: 0};
	}

	if (auth.apiKey === undefined || auth.apiKey === '') {
		return {ok: false, error: 'Reviewer API key is missing.', cost: 0};
	}

	const timeout = createTimeoutSignal(context.signal, config.review.timeoutMs);
	const callOptions = {
		apiKey: auth.apiKey, headers: auth.headers, maxTokens: 4096, signal: timeout.signal,
	};
	const toolChoice = forcedToolChoice(model);
	let response: Awaited<ReturnType<typeof complete>>;

	try {
		response = await complete(
			model,
			{systemPrompt: call.systemPrompt, messages: call.messages, tools: [call.tool]},
			{...callOptions, ...((toolChoice !== undefined) && {toolChoice})},
		);
	} catch (error: unknown) {
		return {ok: false, error: `Reviewer request failed: ${errorMessage(error)}`, cost: 0};
	} finally {
		timeout.cleanup();
	}

	const cost = reviewCost(response);

	if (response.stopReason === 'error' || response.stopReason === 'aborted') {
		return {ok: false, error: `Reviewer request failed (${response.stopReason}): ${response.errorMessage ?? 'unknown error'}`, cost};
	}

	const toolCall = response.content.find((part): part is ToolCall => part.type === 'toolCall' && part.name === call.tool.name);

	if (toolCall !== undefined) {
		const result = call.parseToolArguments(toolCall.arguments);
		return result.ok ? {ok: true, value: result.value, cost} : {ok: false, error: result.error, cost};
	}

	if (call.parseTextFallback !== undefined) {
		const textResult = call.parseTextFallback(extractTextResponse(response));
		if (textResult.ok) {
			return {ok: true, value: textResult.value, cost};
		}
	}

	const rawText = extractTextResponse(response).slice(0, 200);
	const contentTypes = response.content.map(part => part.type).join(', ');
	return {
		ok: false,
		error: `Reviewer did not call the ${call.tool.name} tool (stopReason: ${response.stopReason}, content: ${contentTypes}). Text: ${rawText === '' ? '(empty)' : rawText}.`,
		cost,
	};
}
