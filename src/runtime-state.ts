import {defaultConfig} from './config.ts';
import {DenialTracker} from './denial-tracker.ts';

export type LastDecision = {
	toolName: string;
	decision: 'approve' | 'deny' | 'failure';
	rationale: string;
	cost: number;
	saferAlternative?: string;
};

export type LastOutputReview = {
	toolName: string;
	containsSensitive: boolean;
	rationale: string;
	categories: string[];
	cost: number;
};

export type RuntimeState = {
	tracker: DenialTracker;
	lastDecision: LastDecision | undefined;
	lastOutputReview: LastOutputReview | undefined;
	isReviewEnabled: boolean;
	recentReviewHeadlines: string[];
	sessionCost: number;
};

export function createRuntimeState(): RuntimeState {
	return {
		tracker: new DenialTracker(defaultConfig.review),
		lastDecision: undefined,
		lastOutputReview: undefined,
		isReviewEnabled: true,
		recentReviewHeadlines: [],
		sessionCost: 0,
	};
}
