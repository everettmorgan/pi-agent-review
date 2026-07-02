import {isCustomEntry, isRecord} from './shared/guards.ts';

export const agentReviewStateEntryType = 'agent-review-state';

export type SessionReviewState = {
	isReviewEnabled: boolean;
};

export const defaultSessionReviewState: SessionReviewState = {
	isReviewEnabled: true,
};

function isStateData(value: unknown): value is SessionReviewState {
	return isRecord(value) && typeof value.isReviewEnabled === 'boolean';
}

export function getReviewStateFromBranch(branch: unknown[]): SessionReviewState {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (isCustomEntry(entry) && entry.customType === agentReviewStateEntryType && isStateData(entry.data)) {
			return {isReviewEnabled: entry.data.isReviewEnabled};
		}
	}

	return defaultSessionReviewState;
}

export function makeReviewStateEntryData(isReviewEnabled: boolean): SessionReviewState {
	return {isReviewEnabled};
}
