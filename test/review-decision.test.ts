import {describe, expect, it} from 'vitest';
import {formatDenialReason, parseReviewDecision} from '../src/review/review-decision.ts';

describe('parseReviewDecision', () => {
	it('accepts strict approve JSON', () => {
		expect(parseReviewDecision('{"decision":"approve","rationale":"Scoped read."}')).toEqual({
			ok: true,
			value: {decision: 'approve', rationale: 'Scoped read.'},
		});
	});

	it('accepts strict deny JSON with safer alternative', () => {
		expect(parseReviewDecision('{"decision":"deny","rationale":"Fork bomb.","saferAlternative":"Run a bounded test."}')).toEqual({
			ok: true,
			value: {decision: 'deny', rationale: 'Fork bomb.', saferAlternative: 'Run a bounded test.'},
		});
	});

	it('accepts JSON wrapped in text and markdown fences', () => {
		const result = parseReviewDecision('Here is my decision:\n```json\n{"decision":"approve","rationale":"ok"}\n```\nLet me know.');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.decision).toBe('approve');
		}
	});

	it('rejects output with no JSON object', () => {
		const result = parseReviewDecision('I cannot decide, no structured output here.');

		expect(result.ok).toBe(false);
	});

	it('formats no-workaround denial guidance', () => {
		expect(formatDenialReason({decision: 'deny', rationale: 'Unsafe.', saferAlternative: 'Read first.'})).toContain('Do not pursue the same outcome');
	});
});
