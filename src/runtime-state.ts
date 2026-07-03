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
	// Session on/off switch. Deliberately plain in-memory process state, never
	// persisted to or re-synced from the session branch: branch entries don't
	// survive retries or forks, which made the old branch-synced toggle
	// silently re-enable itself. Re-armed on session_start with reason
	// 'new'/'resume' so off can't outlive the session it was meant for.
	isReviewEnabled: boolean;
	sessionCost: number;
};

export function createRuntimeState(): RuntimeState {
	return {
		tracker: new DenialTracker(defaultConfig.review),
		lastDecision: undefined,
		lastOutputReview: undefined,
		isReviewEnabled: true,
		sessionCost: 0,
	};
}
