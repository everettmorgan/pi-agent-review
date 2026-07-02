import {stringify} from 'safe-stable-stringify';

export type NormalizeToolCallInput = {
	toolName: string;
	input: unknown;
	cwd: string;
};

export type ApprovalState = {
	status: 'approved_by_user';
	argsHash: string;
};

export type NormalizeOptions = {
	approval?: ApprovalState;
	argsHash?: string;
};

export type ReviewRequest = {
	toolName: string;
	cwd: string;
	argumentsJson: string;
	approval?: ApprovalState;
	argsHash?: string;
};

const defaultArgumentLimit = 12_000;

export function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, maxChars)}\n[truncated ${String(text.length - maxChars)} characters]`;
}

export function neutralizeFence(text: string): string {
	return text
		.replaceAll('<untrusted_tool_call>', 'untrusted_tool_call')
		.replaceAll('</untrusted_tool_call>', '/untrusted_tool_call')
		.replaceAll('<untrusted_transcript>', 'untrusted_transcript')
		.replaceAll('</untrusted_transcript>', '/untrusted_transcript');
}

export function normalizeToolCall(input: NormalizeToolCallInput, options: NormalizeOptions = {}): ReviewRequest {
	const serialized = stringify(input.input) ?? 'null';
	const request: ReviewRequest = {
		toolName: input.toolName,
		cwd: input.cwd,
		argumentsJson: neutralizeFence(truncateText(serialized, defaultArgumentLimit)),
	};

	if (options.approval) {
		request.approval = options.approval;
	}

	const argsHash = options.argsHash ?? options.approval?.argsHash;
	if (argsHash !== undefined) {
		request.argsHash = argsHash;
	}

	return request;
}
