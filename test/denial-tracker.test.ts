import {describe, expect, it} from 'vitest';
import {DenialTracker} from '../denial-tracker.ts';

describe('DenialTracker', () => {
	it('trips after consecutive denials', () => {
		const tracker = new DenialTracker({consecutiveDenialLimit: 2, rollingDenialLimit: 10});

		tracker.recordDenied();
		const result = tracker.recordDenied();

		expect(result.tripped).toBe(true);
		expect(result.reason).toContain('2 consecutive');
	});

	it('resets consecutive count on approval', () => {
		const tracker = new DenialTracker({consecutiveDenialLimit: 2, rollingDenialLimit: 10});

		tracker.recordDenied();
		tracker.recordApproved();
		const result = tracker.recordDenied();

		expect(result.tripped).toBe(false);
	});

	it('trips after rolling denials', () => {
		const tracker = new DenialTracker({consecutiveDenialLimit: 10, rollingDenialLimit: 2});

		tracker.recordDenied();
		tracker.recordApproved();
		const result = tracker.recordDenied();

		expect(result.tripped).toBe(true);
		expect(result.reason).toContain('2 denials');
	});
});
