import {stringify} from 'safe-stable-stringify';

export type NormalizeToolCallInput = {
	toolName: string;
	input: unknown;
	cwd: string;
};

export type ApprovalState = {
	status: 'approved_by_user';
	// What the user approved, for the reviewer to compare against the proposed call.
	approvedAction: string;
};

export type NormalizeOptions = {
	approval?: ApprovalState;
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

export function neutralizeFence(text: string): string {
	return text
		.replaceAll('<untrusted_tool_call>', 'untrusted_tool_call')
		.replaceAll('</untrusted_tool_call>', '/untrusted_tool_call')
		.replaceAll('<untrusted_transcript>', 'untrusted_transcript')
		.replaceAll('</untrusted_transcript>', '/untrusted_transcript')
		.replaceAll('<untrusted_tool_output>', 'untrusted_tool_output')
		.replaceAll('</untrusted_tool_output>', '/untrusted_tool_output');
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

	return request;
}
