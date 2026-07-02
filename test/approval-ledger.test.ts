import {describe, expect, it} from 'vitest';
import {ApprovalLedger, computeArgsHash} from '../approval-ledger.ts';

describe('computeArgsHash', () => {
	it('produces stable hashes for the same input', () => {
		const a = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		const b = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		expect(a).toBe(b);
	});

	it('produces different hashes for different inputs', () => {
		const a = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		const b = computeArgsHash('read', {path: 'other.ts'}, '/repo');
		expect(a).not.toBe(b);
	});

	it('produces different hashes for different tools', () => {
		const a = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		const b = computeArgsHash('write', {path: 'index.ts'}, '/repo');
		expect(a).not.toBe(b);
	});

	it('produces different hashes for different cwds', () => {
		const a = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		const b = computeArgsHash('read', {path: 'index.ts'}, '/other');
		expect(a).not.toBe(b);
	});
});

describe('ApprovalLedger', () => {
	it('starts empty', () => {
		const ledger = new ApprovalLedger();
		expect(ledger.snapshot()).toEqual({pending: [], consumed: 0});
	});

	it('records and matches exact approvals', () => {
		const ledger = new ApprovalLedger();
		const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');
		ledger.record({argsHash: hash});

		expect(ledger.hasPending(hash)).toBe(true);
	});

	it('consumes one-shot approvals on match', () => {
		const ledger = new ApprovalLedger();
		const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');
		ledger.record({argsHash: hash});

		expect(ledger.consume(hash)).toBe(true);
		expect(ledger.hasPending(hash)).toBe(false);
		expect(ledger.snapshot().consumed).toBe(1);
	});

	it('rejects consume for unknown hash', () => {
		const ledger = new ApprovalLedger();
		expect(ledger.consume('unknown')).toBe(false);
	});

	it('rejects hash collision for different args', () => {
		const ledger = new ApprovalLedger();
		const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');
		ledger.record({argsHash: hash});

		const differentHash = computeArgsHash('write', {path: 'bar.ts', content: 'y'}, '/repo');
		expect(ledger.hasPending(differentHash)).toBe(false);
	});

	it('restores from branch entries', () => {
		const ledger = new ApprovalLedger();
		const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: {argsHash: hash, oneShot: true}},
		]);

		expect(ledger.hasPending(hash)).toBe(true);
	});

	it('ignores consumed branch entries', () => {
		const ledger = new ApprovalLedger();
		const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: {argsHash: hash, oneShot: true}},
			{type: 'custom', customType: 'agent-review-consumption', data: {argsHash: hash}},
		]);

		expect(ledger.hasPending(hash)).toBe(false);
	});
});
