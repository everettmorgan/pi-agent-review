import {describe, expect, it} from 'vitest';
import {
	ApprovalLedger,
	approvalTtlMs,
	computeArgsHash,
	type PendingApproval,
} from '../src/approval/approval-ledger.ts';

const now = 1_000_000;

function approvalFor(argsHash: string, nonce: string, createdAt = now): PendingApproval {
	return {argsHash, nonce, expiresAt: createdAt + approvalTtlMs};
}

describe('computeArgsHash', () => {
	it('produces stable hashes for the same input', () => {
		const a = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		const b = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		expect(a).toBe(b);
	});

	it('produces different hashes for different inputs, tools, and cwds', () => {
		const base = computeArgsHash('read', {path: 'index.ts'}, '/repo');
		expect(computeArgsHash('read', {path: 'other.ts'}, '/repo')).not.toBe(base);
		expect(computeArgsHash('write', {path: 'index.ts'}, '/repo')).not.toBe(base);
		expect(computeArgsHash('read', {path: 'index.ts'}, '/other')).not.toBe(base);
	});
});

describe('ApprovalLedger', () => {
	const hash = computeArgsHash('write', {path: 'foo.ts', content: 'x'}, '/repo');

	it('starts empty', () => {
		expect(new ApprovalLedger().snapshot()).toEqual({pending: [], consumed: 0});
	});

	it('finds a live approval by args hash', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		expect(ledger.findPending(hash, now)?.nonce).toBe('n1');
	});

	it('does not match a different call', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		const other = computeArgsHash('write', {path: 'bar.ts', content: 'y'}, '/repo');
		expect(ledger.findPending(other, now)).toBeUndefined();
	});

	it('treats an expired approval as absent', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		expect(ledger.findPending(hash, now + approvalTtlMs + 1)).toBeUndefined();
	});

	it('consumes exactly one grant by nonce', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		expect(ledger.consume('n1')).toBe(true);
		expect(ledger.findPending(hash, now)).toBeUndefined();
		expect(ledger.snapshot().consumed).toBe(1);
	});

	it('binds a grant to one execution even when the call repeats', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		expect(ledger.consume('n1')).toBe(true);
		// A byte-identical later call finds no approval unless a new one was granted.
		expect(ledger.findPending(hash, now)).toBeUndefined();
	});

	it('keeps distinct grants for the same call independent', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor(hash, 'n1'));
		ledger.record(approvalFor(hash, 'n2'));
		ledger.consume('n1');
		expect(ledger.findPending(hash, now)?.nonce).toBe('n2');
	});

	it('rejects consume for an unknown nonce', () => {
		expect(new ApprovalLedger().consume('missing')).toBe(false);
	});

	it('restores unconsumed approvals from the branch', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor(hash, 'n1')},
		]);
		expect(ledger.findPending(hash, now)?.nonce).toBe('n1');
	});

	it('pairs consumption to its approval by nonce', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor(hash, 'n1')},
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'n1'}},
		]);
		expect(ledger.findPending(hash, now)).toBeUndefined();
		expect(ledger.snapshot().consumed).toBe(1);
	});

	it('does not let an unrelated consumption re-arm or drop a different grant', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor(hash, 'n1')},
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'other'}},
		]);
		expect(ledger.findPending(hash, now)?.nonce).toBe('n1');
	});
});
