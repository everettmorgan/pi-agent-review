import {describe, expect, it} from 'vitest';
import {defaultSessionReviewState, getReviewStateFromBranch, makeReviewStateEntryData} from '../session-state.ts';

describe('session review state', () => {
	it('defaults review to enabled without session state', () => {
		expect(getReviewStateFromBranch([])).toEqual(defaultSessionReviewState);
	});

	it('restores latest agent-review-state entry from branch', () => {
		const branch = [
			{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: false}},
			{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: true}},
		];

		expect(getReviewStateFromBranch(branch)).toEqual({isReviewEnabled: true});
	});

	it('ignores malformed state entries', () => {
		const branch = [{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: 'no'}}];

		expect(getReviewStateFromBranch(branch)).toEqual(defaultSessionReviewState);
	});

	it('creates serializable state entry data', () => {
		expect(makeReviewStateEntryData(false)).toEqual({isReviewEnabled: false});
	});
});
