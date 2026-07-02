import {buildTrustedIntentContext, formatTrustedIntentContext} from './approval-context.ts';
import type {AgentReviewConfig} from '../config.ts';
import type {ReviewRequest} from './normalize-tool-call.ts';
import {runReviewer, type ReviewerContext, type ReviewerResult} from './reviewer.ts';
import {compactTranscript, type TranscriptOptions} from './transcript.ts';

export const transcriptLimits: TranscriptOptions = {maxEntries: 30, maxChars: 20_000};

export type ReviewSessionContext = ReviewerContext & {
	sessionManager: {getBranch(): unknown[]};
};

export async function performReview(context: ReviewSessionContext, config: AgentReviewConfig, request: ReviewRequest): Promise<ReviewerResult> {
	const branch = context.sessionManager.getBranch();
	const trustedIntent = formatTrustedIntentContext(buildTrustedIntentContext(branch));
	const transcript = compactTranscript(context.sessionManager, transcriptLimits);
	return runReviewer(context, config, request, trustedIntent, transcript);
}

export function formatCost(cost: number): string {
	return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

export type ReviewOutcome = 'Approved' | 'Denied' | 'Failed';

export function formatOutcome(outcome: ReviewOutcome, toolName: string, body: string, cost: number, saferAlternative?: string): string {
	const lines = [`${outcome}: ${toolName}`, '', body];
	if (saferAlternative !== undefined) {
		lines.push('', `Alternative: ${saferAlternative}`);
	}

	lines.push('', `Cost: ${formatCost(cost)}`);
	return lines.join('\n');
}
