import {isRecord} from '../shared/guards.ts';

export type ApprovalDecision = {
	action: 'allow';
} | {
	action: 'deny';
	reason: string;
};

type ToolCallInput = {
	toolName: string;
	input: unknown;
	cwd: string;
};

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
	const filePath = extractPath(call.input);
	if (filePath !== undefined && targetsSecret(normalizePath(filePath, call.cwd))) {
		return {action: 'deny', reason: `Access to secret or credential file is not permitted: ${filePath}`};
	}

	return {action: 'allow'};
}
