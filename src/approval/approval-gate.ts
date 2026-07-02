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

// Keys whose string values name a filesystem target. `command` is included so
// shell invocations (bash) that read or exfiltrate secrets are caught, since
// they never carry a structured `path`. This covers the common tool shapes; the
// LLM reviewer remains the backstop for exotic argument layouts.
const pathKeys = ['path', 'file_path', 'filePath', 'filename'];

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

function collectCandidateStrings(input: unknown): string[] {
	if (!isRecord(input)) {
		return [];
	}

	const candidates: string[] = [];
	for (const key of pathKeys) {
		if (typeof input[key] === 'string') {
			candidates.push(input[key]);
		}
	}

	if (Array.isArray(input.paths)) {
		candidates.push(...input.paths.filter((value): value is string => typeof value === 'string'));
	}

	if (typeof input.command === 'string') {
		candidates.push(input.command);
	}

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
