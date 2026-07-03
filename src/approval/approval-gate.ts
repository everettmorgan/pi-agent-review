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

// Keys whose string values name a filesystem target or executable payload,
// matched case-insensitively at ANY nesting depth so structured tool shapes
// (multi-edit arrays, wrapped configs) can't smuggle a secret path past the
// gate. Command/code keys are included because shell and eval invocations
// that read secrets never carry a structured `path`. Content-ish keys
// (old_string, new_string, content) are deliberately excluded: prose merely
// mentioning `.env` must not hard-deny, and the LLM reviewer remains the
// backstop for exotic layouts.
const pathKeys = new Set(['path', 'file_path', 'filepath', 'filename', 'file', 'paths', 'target', 'source', 'dir', 'directory']);
const commandKeys = new Set(['command', 'cmd', 'script', 'code']);
const maxGateDepth = 6;

// High-confidence secret markers only. Ambiguous names (`sort.key`, `/token`,
// `credential-helper.ts`) are deliberately left to the reviewer rather than
// hard-denied here, because a gate false positive blocks the file with no
// user-approval override.
const secretPatterns: RegExp[] = [
	/(?:^|\/)\.env(?:\.[^\/]*)?$/v, // .env, .env.local, .env.production
	/(?:^|\/)\.npmrc$/v,
	/(?:^|\/)id_rsa$/v,
	/(?:^|\/)id_ed25519$/v,
	/\.pem$/v,
	/(?:^|\/)credentials$/v, // ~/.aws/credentials, not credential-helper.ts
	/(?:^|\/)\.ssh\//v,
	/(?:^|\/)\.aws\//v,
	/(?:^|\/)\.gnupg\//v,
];

function isCandidateKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return pathKeys.has(normalized) || commandKeys.has(normalized);
}

function collectFromEntry(key: string, value: unknown, depth: number, out: string[]): void {
	if (typeof value === 'string') {
		if (isCandidateKey(key)) {
			out.push(value);
		}

		return;
	}

	if (Array.isArray(value) && isCandidateKey(key)) {
		out.push(...value.filter((item): item is string => typeof item === 'string'));
	}

	collectCandidates(value, depth, out);
}

function collectCandidates(value: unknown, depth: number, out: string[]): void {
	if (depth >= maxGateDepth) {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectCandidates(item, depth + 1, out);
		}

		return;
	}

	if (!isRecord(value)) {
		return;
	}

	for (const [key, entry] of Object.entries(value)) {
		collectFromEntry(key, entry, depth + 1, out);
	}
}

function collectCandidateStrings(input: unknown): string[] {
	const candidates: string[] = [];
	collectCandidates(input, 0, candidates);
	return candidates;
}

// Split a freeform string (e.g. a shell command) into path-like tokens, stripping
// shell operators, quotes, and argument sigils such as `@` in
// `curl --data-binary @.env`. Also defeats trailing-whitespace bypasses.
function tokenizePaths(value: string): string[] {
	return value
		.replaceAll('\\', '/')
		.toLowerCase()
		// eslint-disable-next-line regexp/sort-character-class-elements, no-useless-escape, regexp/no-useless-escape
		.split(/[\s"'\(\),;<=>`\|\&]+/v)
		.map(token => token.replace(/^[@~]+/v, ''))
		.filter(token => token.length > 0);
}

function targetsSecret(value: string): boolean {
	return tokenizePaths(value).some(token => secretPatterns.some(pattern => pattern.test(token)));
}

export function classifyToolCall(call: ToolCallInput): ApprovalDecision {
	for (const candidate of collectCandidateStrings(call.input)) {
		if (targetsSecret(candidate)) {
			return {action: 'deny', reason: `Access to a secret or credential path is not permitted: ${candidate.trim().slice(0, 200)}`};
		}
	}

	return {action: 'allow'};
}
