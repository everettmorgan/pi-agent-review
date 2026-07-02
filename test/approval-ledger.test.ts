import {describe, expect, it} from 'vitest';
import {
	ApprovalLedger,
	approvalTtlMs,
	type PendingApproval,
} from '../src/approval/approval-ledger.ts';

const now = 1_000_000;

function approvalFor(toolName: string, nonce: string, createdAt = now): PendingApproval {
	return {
		nonce, toolName, approvedAction: `Tool: ${toolName}`, expiresAt: createdAt + approvalTtlMs,
	};
}

describe('ApprovalLedger', () => {
	it('starts empty', () => {
		expect(new ApprovalLedger().snapshot()).toEqual({pending: [], consumed: 0});
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
		expect(ledger.snapshot().consumed).toBe(1);
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
		expect(ledger.snapshot().consumed).toBe(1);
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
