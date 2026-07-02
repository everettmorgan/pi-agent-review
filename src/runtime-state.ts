import {defaultConfig} from './config.ts';
import {DenialTracker} from './denial-tracker.ts';
import {defaultSessionReviewState, type SessionReviewState} from './session-state.ts';

export type LastDecision = {
	toolName: string;
	decision: 'approve' | 'deny' | 'failure';
	rationale: string;
	cost: number;
	saferAlternative?: string;
};

export type RuntimeState = {
	tracker: DenialTracker;
	lastDecision: LastDecision | undefined;
	reviewState: SessionReviewState;
	sessionCost: number;
};

export function createRuntimeState(): RuntimeState {
	return {
		tracker: new DenialTracker(defaultConfig.review),
		lastDecision: undefined,
		reviewState: defaultSessionReviewState,
		sessionCost: 0,
	};
}
