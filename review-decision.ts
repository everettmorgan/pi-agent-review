import {errorMessage, isRecord} from './guards.ts';

export type ReviewDecision = {
	decision: 'approve' | 'deny';
	rationale: string;
	saferAlternative?: string;
};

export type DecisionParseResult = {ok: true; value: ReviewDecision} | {ok: false; error: string};

const noWorkaroundGuidance = 'Do not pursue the same outcome through workaround, indirect execution, or policy circumvention. Continue only with a materially safer alternative, or stop and ask the user.';

export function validateDecision(value: unknown): DecisionParseResult {
	if (!isRecord(value)) {
		return {ok: false, error: 'Reviewer output must be a JSON object.'};
	}

	if (value.decision !== 'approve' && value.decision !== 'deny') {
		return {ok: false, error: 'Reviewer decision must be approve or deny.'};
	}

	if (typeof value.rationale !== 'string' || value.rationale.trim() === '') {
		return {ok: false, error: 'Reviewer rationale is required.'};
	}

	if (value.saferAlternative !== undefined && typeof value.saferAlternative !== 'string') {
		return {ok: false, error: 'Reviewer saferAlternative must be a string.'};
	}

	return {
		ok: true,
		value: {
			decision: value.decision,
			rationale: value.rationale,
			...((value.saferAlternative !== undefined) && {saferAlternative: value.saferAlternative}),
		},
	};
}

function processCharacter(character: string, state: {depth: number; isInString: boolean; isEscaped: boolean}): 'continue' | 'found' | undefined {
	if (state.isInString) {
		if (state.isEscaped) {
			state.isEscaped = false;
		} else if (character === '\\') {
			state.isEscaped = true;
		} else if (character === '"') {
			state.isInString = false;
		}

		return 'continue';
	}

	switch (character) {
		case '"': {
			state.isInString = true;
			return 'continue';
		}

		case '{': {
			state.depth++;
			return 'continue';
		}

		case '}': {
			state.depth--;
			if (state.depth === 0) {
				return 'found';
			}

			return 'continue';
		}

		default: {
			return 'continue';
		}
	}
}

function extractJsonObject(text: string): string | undefined {
	const start = text.indexOf('{');
	if (start === -1) {
		return undefined;
	}

	const state = {depth: 0, isInString: false, isEscaped: false};
	for (let index = start; index < text.length; index++) {
		const character = text[index] ?? '';
		const result = processCharacter(character, state);
		if (result === 'found') {
			return text.slice(start, index + 1);
		}
	}

	return undefined;
}

export function parseReviewDecision(text: string): DecisionParseResult {
	const json = extractJsonObject(text);
	if (json === undefined) {
		return {ok: false, error: 'Reviewer output did not contain a JSON object.'};
	}

	try {
		return validateDecision(JSON.parse(json));
	} catch (error: unknown) {
		return {ok: false, error: `Reviewer output was not valid JSON: ${errorMessage(error)}`};
	}
}

export function formatDenialReason(decision: ReviewDecision): string {
	const alternative = decision.saferAlternative === undefined ? '' : ` Safer alternative: ${decision.saferAlternative}`;
	return `Agent Review denied this tool call: ${decision.rationale}.${alternative} ${noWorkaroundGuidance}`;
}

export function formatReviewerFailureReason(reason: string): string {
	return `Agent Review blocked this tool call because reviewer approval failed: ${reason}`;
}
