import {
	access,
	mkdir,
	readFile,
	writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {errorMessage} from './shared/guards.ts';

export type ReviewConfig = {
	timeoutMs: number;
	denyOnReviewerFailure: true;
	consecutiveDenialLimit: number;
	rollingDenialLimit: number;
};

export type ReviewerConfig = {
	type: 'direct-model';
	provider: string;
	model: string;
};

export type AgentReviewConfig = {
	review: ReviewConfig;
	reviewer: ReviewerConfig;
};

export type ConfigResult = {ok: true; value: AgentReviewConfig} | {ok: false; error: string};

export const configPath = path.join(homedir(), '.pi', 'agent', 'agent-review', 'config.json');

export const defaultConfig: AgentReviewConfig = {
	review: {
		timeoutMs: 30_000,
		denyOnReviewerFailure: true,
		consecutiveDenialLimit: 3,
		rollingDenialLimit: 10,
	},
	reviewer: {
		type: 'direct-model',
		provider: 'current',
		model: 'current',
	},
};

type PartialConfig = {
	review?: Partial<ReviewConfig>;
	reviewer?: Partial<ReviewerConfig>;
};

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

// Copy only known fields from the (untrusted) parsed config, so legacy or
// unexpected keys are dropped rather than carried through and later persisted.
function mergeConfig(input: PartialConfig): AgentReviewConfig {
	const review = input.review ?? {};
	const reviewer = input.reviewer ?? {};
	return {
		review: {
			timeoutMs: review.timeoutMs ?? defaultConfig.review.timeoutMs,
			denyOnReviewerFailure: true,
			consecutiveDenialLimit: review.consecutiveDenialLimit ?? defaultConfig.review.consecutiveDenialLimit,
			rollingDenialLimit: review.rollingDenialLimit ?? defaultConfig.review.rollingDenialLimit,
		},
		reviewer: {
			type: 'direct-model',
			provider: reviewer.provider ?? defaultConfig.reviewer.provider,
			model: reviewer.model ?? defaultConfig.reviewer.model,
		},
	};
}

function validatePositiveInteger(value: number, fieldPath: string): string | undefined {
	return Number.isSafeInteger(value) && value > 0 ? undefined : `${fieldPath} must be a positive integer`;
}

function validateConfig(config: AgentReviewConfig): string | undefined {
	return (
		validatePositiveInteger(config.review.timeoutMs, 'review.timeoutMs')
		?? validatePositiveInteger(config.review.consecutiveDenialLimit, 'review.consecutiveDenialLimit')
		?? validatePositiveInteger(config.review.rollingDenialLimit, 'review.rollingDenialLimit')
	);
}

export async function loadConfigFromPath(filePath: string): Promise<ConfigResult> {
	if (!(await exists(filePath))) {
		return {ok: true, value: defaultConfig};
	}

	try {
		const raw = await readFile(filePath, 'utf8');
		const parsed = JSON.parse(raw) as PartialConfig;
		const config = mergeConfig(parsed);
		const validationError = validateConfig(config);
		if (validationError !== undefined) {
			return {ok: false, error: validationError};
		}

		return {ok: true, value: config};
	} catch (error: unknown) {
		return {ok: false, error: `Invalid config at ${filePath}: ${errorMessage(error)}`};
	}
}

export async function setReviewerModel(filePath: string, spec: string): Promise<ConfigResult> {
	const trimmed = spec.trim();
	let provider: string;
	let model: string;

	if (trimmed === 'current') {
		provider = 'current';
		model = 'current';
	} else {
		const slash = trimmed.indexOf('/');
		if (slash === -1) {
			return {ok: false, error: 'Reviewer model must be "current" or "provider/model".'};
		}

		provider = trimmed.slice(0, slash).trim();
		model = trimmed.slice(slash + 1).trim();
		if (provider === '' || model === '') {
			return {ok: false, error: 'Reviewer model must be "current" or "provider/model" with non-empty provider and model.'};
		}
	}

	const current = await loadConfigFromPath(filePath);
	const base = current.ok ? current.value : defaultConfig;
	const next: AgentReviewConfig = {
		...base,
		reviewer: {...base.reviewer, provider, model},
	};

	try {
		await mkdir(path.dirname(filePath), {recursive: true});
		await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
		return {ok: true, value: next};
	} catch (error: unknown) {
		return {ok: false, error: `Failed to write config at ${filePath}: ${errorMessage(error)}`};
	}
}
