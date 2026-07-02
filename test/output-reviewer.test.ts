import {describe, expect, it} from 'vitest';
import {validateOutputReview} from '../src/review/output-reviewer.ts';

describe('validateOutputReview', () => {
	it('accepts a well-formed sensitive finding', () => {
		const result = validateOutputReview({containsSensitive: true, rationale: 'Contains an AWS secret key.', categories: ['aws-key']});
		expect(result).toEqual({ok: true, value: {containsSensitive: true, rationale: 'Contains an AWS secret key.', categories: ['aws-key']}});
	});

	it('defaults categories to an empty array when omitted', () => {
		const result = validateOutputReview({containsSensitive: false, rationale: 'No secrets found.'});
		expect(result).toEqual({ok: true, value: {containsSensitive: false, rationale: 'No secrets found.', categories: []}});
	});

	it('drops non-string categories', () => {
		const result = validateOutputReview({containsSensitive: true, rationale: 'x', categories: ['jwt', 42, null]});
		expect(result.ok && result.value.categories).toEqual(['jwt']);
	});

	it('rejects a non-object', () => {
		expect(validateOutputReview('nope').ok).toBe(false);
	});

	it('rejects a missing boolean verdict', () => {
		expect(validateOutputReview({rationale: 'x'}).ok).toBe(false);
	});

	it('rejects an empty rationale', () => {
		expect(validateOutputReview({containsSensitive: true, rationale: ' '.repeat(3)}).ok).toBe(false);
	});
});
