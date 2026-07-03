import {stringify} from 'safe-stable-stringify';

export type NormalizeToolCallInput = {
	toolName: string;
	input: unknown;
	cwd: string;
};

export type ApprovalState = {
	status: 'approved_by_user';
	approvedAction: string;
};

export type ReviewRequest = {
	toolName: string;
	cwd: string;
	argumentsJson: string;
	approval?: ApprovalState;
};

const defaultArgumentLimit = 12_000;

export function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, maxChars)}\n[truncated ${String(text.length - maxChars)} characters]`;
}

const closingFencePattern = /<\s*\/\s*(?<tag>untrusted_(?:tool_call|transcript|tool_output))\s*>/giv;
const openingFencePattern = /<\s*(?<tag>untrusted_(?:tool_call|transcript|tool_output))\s*>/giv;

export function neutralizeFence(text: string): string {
	return text
		.replaceAll(closingFencePattern, '/$<tag>')
		.replaceAll(openingFencePattern, '$<tag>');
}

export function normalizeToolCall(input: NormalizeToolCallInput, approval?: ApprovalState): ReviewRequest {
	const serialized = stringify(input.input) ?? 'null';
	const request: ReviewRequest = {
		toolName: input.toolName,
		cwd: input.cwd,
		argumentsJson: neutralizeFence(truncateText(serialized, defaultArgumentLimit)),
	};

	if (approval !== undefined) {
		request.approval = approval;
	}

	return request;
}
