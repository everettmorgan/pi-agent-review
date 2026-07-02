export type DenialTrackerLimits = {
	consecutiveDenialLimit: number;
	rollingDenialLimit: number;
};

export type DenialTrackerResult = {
	tripped: boolean;
	reason?: string;
};

export type DenialTrackerSnapshot = {
	consecutiveDenials: number;
	rollingDenials: number;
};

const rollingWindowSize = 50;

export class DenialTracker {
	private consecutiveDenials = 0;
	private readonly rollingOutcomes: Array<'approved' | 'denied'> = [];

	constructor(private readonly limits: DenialTrackerLimits) {}

	private recordOutcome(outcome: 'approved' | 'denied'): void {
		this.rollingOutcomes.push(outcome);
		if (this.rollingOutcomes.length > rollingWindowSize) {
			this.rollingOutcomes.shift();
		}
	}

	recordApproved(): DenialTrackerResult {
		this.consecutiveDenials = 0;
		this.recordOutcome('approved');
		return {tripped: false};
	}

	recordDenied(): DenialTrackerResult {
		this.consecutiveDenials += 1;
		this.recordOutcome('denied');

		if (this.consecutiveDenials >= this.limits.consecutiveDenialLimit) {
			return {tripped: true, reason: `Agent Review circuit breaker tripped after ${String(this.consecutiveDenials)} consecutive denials.`};
		}

		const rollingDenials = this.rollingOutcomes.filter(outcome => outcome === 'denied').length;
		if (rollingDenials >= this.limits.rollingDenialLimit) {
			return {tripped: true, reason: `Agent Review circuit breaker tripped after ${String(rollingDenials)} denials in the rolling window.`};
		}

		return {tripped: false};
	}

	snapshot(): DenialTrackerSnapshot {
		return {
			consecutiveDenials: this.consecutiveDenials,
			rollingDenials: this.rollingOutcomes.filter(outcome => outcome === 'denied').length,
		};
	}
}
