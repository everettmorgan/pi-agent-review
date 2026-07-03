import {describe, expect, it} from 'vitest';
import {
	ApprovalLedger,
	approvalTtlMs,
	type PendingApproval,
} from '../src/approval/approval-ledger.ts';

const now = 1_000_000;

function approvalFor(toolName: string, nonce: string, createdAt = now): PendingApproval {
	return {
		nonce, toolName, inputJson: `{"tool":"${toolName}"}`, cwd: '/repo', approvedAction: `Tool: ${toolName}`, expiresAt: createdAt + approvalTtlMs,
	};
}

describe('ApprovalLedger', () => {
	it('starts empty', () => {
		expect(new ApprovalLedger().snapshot(now)).toEqual({pending: [], consumed: 0});
	});

	it('finds a live approval by tool name', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.findPendingForTool('bash', now)?.nonce).toBe('n1');
	});

	it('does not match a different tool', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.findPendingForTool('write', now)).toBeUndefined();
	});

	it('treats an expired approval as absent', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.findPendingForTool('bash', now + approvalTtlMs + 1)).toBeUndefined();
	});

	it('consumes exactly one grant by nonce', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.consume('n1')).toBe(true);
		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
		expect(ledger.snapshot(now).consumed).toBe(1);
	});

	it('finds an exact match on tool, input, and cwd', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.findExactMatch('bash', '{"tool":"bash"}', '/repo', now)?.nonce).toBe('n1');
	});

	it('does not exact-match a different input, cwd, or expired grant', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.findExactMatch('bash', '{"tool":"other"}', '/repo', now)).toBeUndefined();
		expect(ledger.findExactMatch('bash', '{"tool":"bash"}', '/elsewhere', now)).toBeUndefined();
		expect(ledger.findExactMatch('bash', '{"tool":"bash"}', '/repo', now + approvalTtlMs + 1)).toBeUndefined();
	});

	it('excludes expired grants from the snapshot', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.snapshot(now).pending).toEqual(['bash']);
		expect(ledger.snapshot(now + approvalTtlMs + 1).pending).toEqual([]);
	});

	it('binds a grant to one execution even when the tool is used again', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		expect(ledger.consume('n1')).toBe(true);
		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
	});

	it('keeps distinct grants for the same tool independent', () => {
		const ledger = new ApprovalLedger();
		ledger.record(approvalFor('bash', 'n1'));
		ledger.record(approvalFor('bash', 'n2'));
		ledger.consume('n1');
		expect(ledger.findPendingForTool('bash', now)?.nonce).toBe('n2');
	});

	it('rejects consume for an unknown nonce', () => {
		expect(new ApprovalLedger().consume('missing')).toBe(false);
	});

	it('restores unconsumed approvals from the branch', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')},
		]);
		expect(ledger.findPendingForTool('bash', now)?.nonce).toBe('n1');
	});

	it('pairs consumption to its approval by nonce', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')},
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'n1'}},
		]);
		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
		expect(ledger.snapshot(now).consumed).toBe(1);
	});

	it('does not resurrect a consumed grant when restoring a branch that predates the consumption', () => {
		const ledger = new ApprovalLedger();
		const approvalEntry = {type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')};
		ledger.restoreFromBranch([approvalEntry]);
		ledger.consume('n1');

		// A fork/retry branch that contains the approval but not its consumption.
		ledger.restoreFromBranch([approvalEntry]);

		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
	});

	it('drops legacy approval entries that lack inputJson and cwd without throwing', () => {
		const ledger = new ApprovalLedger();
		const legacyData = {
			nonce: 'n1', toolName: 'bash', approvedAction: 'Tool: bash', expiresAt: now + approvalTtlMs,
		};
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: legacyData},
		]);
		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
	});

	it('counts a branch consumption even when the approval was already on the kill list', () => {
		const ledger = new ApprovalLedger();
		const approvalEntry = {type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')};
		ledger.restoreFromBranch([approvalEntry]);
		ledger.consume('n1');

		ledger.restoreFromBranch([
			approvalEntry,
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'n1'}},
		]);

		expect(ledger.snapshot(now).consumed).toBe(1);
	});

	it('keeps a nonce dead across branches once any branch shows its consumption', () => {
		const ledger = new ApprovalLedger();
		const approvalEntry = {type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')};
		ledger.restoreFromBranch([
			approvalEntry,
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'n1'}},
		]);

		ledger.restoreFromBranch([approvalEntry]);

		expect(ledger.findPendingForTool('bash', now)).toBeUndefined();
	});

	it('does not let an unrelated consumption drop a live grant', () => {
		const ledger = new ApprovalLedger();
		ledger.restoreFromBranch([
			{type: 'custom', customType: 'agent-review-approval', data: approvalFor('bash', 'n1')},
			{type: 'custom', customType: 'agent-review-consumption', data: {nonce: 'other'}},
		]);
		expect(ledger.findPendingForTool('bash', now)?.nonce).toBe('n1');
	});
});
