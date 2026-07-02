import {isCustomEntry, isRecord} from '../shared/guards.ts';

export const approvalEntryType = 'agent-review-approval';
export const consumptionEntryType = 'agent-review-consumption';

// A user approval is valid only briefly, so the agent can retry the denied call
// immediately but a coincidentally-similar call much later cannot reuse it.
export const approvalTtlMs = 10 * 60 * 1000;

export type PendingApproval = {
	// Unique per approval; consumes exactly one grant and pairs an approval with
	// its consumption across the session branch.
	nonce: string;
	// Matched to the next call of this tool; the reviewer confirms the call
	// matches approvedAction (no exact-input reproduction needed).
	toolName: string;
	// What the user approved (tool, input, reason), shown to the reviewer.
	approvedAction: string;
	expiresAt: number;
};

export type LedgerSnapshot = {
	pending: string[];
	consumed: number;
};

export class ApprovalLedger {
	private pending: PendingApproval[] = [];
	private consumed = 0;

	record(approval: PendingApproval): void {
		this.pending.push(approval);
	}

	// The oldest live (non-expired) approval for this tool, or undefined.
	findPendingForTool(toolName: string, now: number): PendingApproval | undefined {
		return this.pending.find(approval => approval.toolName === toolName && approval.expiresAt > now);
	}

	// Remove exactly one grant by its nonce. Returns whether one was removed.
	consume(nonce: string): boolean {
		const index = this.pending.findIndex(approval => approval.nonce === nonce);
		if (index === -1) {
			return false;
		}

		this.pending.splice(index, 1);
		this.consumed += 1;
		return true;
	}

	restoreFromBranch(branch: unknown[]): void {
		this.consumed = 0;
		const byNonce = new Map<string, PendingApproval>();

		for (const entry of branch) {
			if (!isCustomEntry(entry)) {
				continue;
			}

			if (entry.customType === approvalEntryType && isApprovalData(entry.data)) {
				byNonce.set(entry.data.nonce, entry.data);
			}

			if (entry.customType === consumptionEntryType && isConsumptionData(entry.data) && byNonce.delete(entry.data.nonce)) {
				this.consumed += 1;
			}
		}

		// eslint-disable-next-line unicorn/prefer-iterator-to-array -- Iterator#toArray needs a newer lib than the project targets.
		this.pending = [...byNonce.values()];
	}

	snapshot(): LedgerSnapshot {
		return {pending: this.pending.map(approval => approval.toolName), consumed: this.consumed};
	}
}

function isApprovalData(data: unknown): data is PendingApproval {
	return isRecord(data)
		&& typeof data.nonce === 'string'
		&& typeof data.toolName === 'string'
		&& typeof data.approvedAction === 'string'
		&& typeof data.expiresAt === 'number';
}

function isConsumptionData(data: unknown): data is {nonce: string} {
	return isRecord(data) && typeof data.nonce === 'string';
}
