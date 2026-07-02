import {isRecord} from './guards.ts';

export type ApprovalDecision = {
	action: 'allow';
} | {
	action: 'require_approval';
	reason: string;
} | {
	action: 'deny';
	reason: string;
};

type ToolCallInput = {
	toolName: string;
	input: unknown;
	cwd: string;
};

const readOnlyTools = new Set(['read', 'ls', 'grep', 'find']);

const allowlistCommands = new Set(['agent-review']);

function extractPath(input: unknown): string | undefined {
	if (!isRecord(input)) {
		return undefined;
	}

	const {path} = input;
	return typeof path === 'string' ? path : undefined;
}

function normalizePath(filePath: string, cwd: string): string {
	let expanded = filePath;
	if (expanded.startsWith('~/')) {
		expanded = expanded.replace('~/', '/HOME/');
	}

	if (!expanded.startsWith('/')) {
		expanded = `${cwd}/${expanded}`;
	}

	return expanded;
}

const secretSuffixes = [
	'.env',
	'.npmrc',
	'/credentials',
	'.pem',
	'id_rsa',
	'id_ed25519',
	'.key',
];

const secretSubstrings = [
	'.env.',
	'.ssh/',
	'/token',
	'/secret',
	'credential',
];

function targetsSecret(path: string): boolean {
	const normalized = path.replaceAll('\\', '/');
	const lower = normalized.toLowerCase();
	return secretSuffixes.some(suffix => lower.endsWith(suffix))
		|| secretSubstrings.some(substring => lower.includes(substring));
}

export function classifyToolCall(call: ToolCallInput): ApprovalDecision {
	const {toolName, input, cwd} = call;

	if (readOnlyTools.has(toolName)) {
		const filePath = extractPath(input);
		if (filePath !== undefined && targetsSecret(normalizePath(filePath, cwd))) {
			return {action: 'deny', reason: `Reading secret or credential file is not permitted: ${filePath}`};
		}

		return {action: 'allow'};
	}

	if (allowlistCommands.has(toolName)) {
		return {action: 'allow'};
	}

	if (toolName === 'bash') {
		return {action: 'require_approval', reason: 'Shell execution requires approval'};
	}

	if (toolName === 'write') {
		return {action: 'require_approval', reason: 'File write requires approval'};
	}

	if (toolName === 'edit') {
		return {action: 'require_approval', reason: 'File edit requires approval'};
	}

	if (toolName === 'mcp') {
		return {action: 'require_approval', reason: 'MCP tool call requires approval'};
	}

	return {action: 'require_approval', reason: `Tool ${toolName} requires approval`};
}
