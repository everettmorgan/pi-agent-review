import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {formatCost} from './review/run-review.ts';
import type {RuntimeState} from './runtime-state.ts';

export const reviewLogEntryType = 'agent-review-log';

export type ReviewLogData = {
	message: string;
};

export type ReviewOutcomeKind = 'pass' | 'block';

export type StatusContext = {
	hasUI: boolean;
	ui: {setStatus(key: string, text: string | undefined): void};
};

const statusKey = 'agent-review';

export function appendReviewLog(pi: ExtensionAPI, state: RuntimeState, context: StatusContext, kind: ReviewOutcomeKind, message: string): void {
	pi.appendEntry<ReviewLogData>(reviewLogEntryType, {message});

	if (kind === 'pass') {
		state.reviewTally.passed += 1;
	} else {
		state.reviewTally.blocked += 1;
	}

	if (context.hasUI) {
		context.ui.setStatus(statusKey, `review ✓${String(state.reviewTally.passed)} ✗${String(state.reviewTally.blocked)} ${formatCost(state.sessionCost)}`);
	}
}

export function showReviewDisabledStatus(context: StatusContext, isEnabled: boolean): void {
	if (context.hasUI) {
		context.ui.setStatus(statusKey, isEnabled ? undefined : 'review off');
	}
}
