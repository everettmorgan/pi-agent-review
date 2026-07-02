export const agentReviewStateEntryType = 'agent-review-state';

export type SessionReviewState = {
	isReviewEnabled: boolean;
};

export const defaultSessionReviewState: SessionReviewState = {
	isReviewEnabled: true,
};

type CustomEntryLike = {
	type?: unknown;
	customType?: unknown;
	data?: unknown;
};

function isStateData(value: unknown): value is SessionReviewState {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& typeof (value as {isReviewEnabled?: unknown}).isReviewEnabled === 'boolean';
}

export function getReviewStateFromBranch(branch: unknown[]): SessionReviewState {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as CustomEntryLike;
		if (entry.type === 'custom' && entry.customType === agentReviewStateEntryType && isStateData(entry.data)) {
			return {isReviewEnabled: entry.data.isReviewEnabled};
		}
	}

	return defaultSessionReviewState;
}

export function makeReviewStateEntryData(isReviewEnabled: boolean): SessionReviewState {
	return {isReviewEnabled};
}
