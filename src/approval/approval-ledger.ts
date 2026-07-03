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
	// Matched to the next call of this tool; an exact input+cwd match is
	// approved mechanically, otherwise the reviewer judges the call against
	// approvedAction and reports whether it matched.
	toolName: string;
	// The exact serialized input and cwd the user approved, for mechanical
	// exact-match approval without trusting the reviewer.
	inputJson: string;
	cwd: string;
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
	// Process-lifetime kill list: a consumed nonce stays dead even when a
	// fork/retry restores a branch that predates its consumption entry.
	private readonly consumedNonces = new Set<string>();

	record(approval: PendingApproval): void {
		this.pending.push(approval);
	}

	// The oldest live (non-expired) approval for this tool, or undefined.
	findPendingForTool(toolName: string, now: number): PendingApproval | undefined {
		return this.pending.find(approval => approval.toolName === toolName && approval.expiresAt > now);
	}

	// A live grant whose serialized input and cwd equal the proposed call's:
	// mechanical proof the user approved exactly this action.
	findExactMatch(toolName: string, inputJson: string, cwd: string, now: number): PendingApproval | undefined {
		return this.pending.find(approval =>
			approval.toolName === toolName
			&& approval.inputJson === inputJson
			&& approval.cwd === cwd
			&& approval.expiresAt > now);
	}

	// Remove exactly one grant by its nonce. Returns whether one was removed.
	consume(nonce: string): boolean {
		const index = this.pending.findIndex(approval => approval.nonce === nonce);
		if (index === -1) {
			return false;
		}

		this.pending.splice(index, 1);
		this.consumed += 1;
		this.consumedNonces.add(nonce);
		return true;
	}

	restoreFromBranch(branch: unknown[]): void {
		this.consumed = 0;
		const byNonce = new Map<string, PendingApproval>();

		for (const entry of branch) {
			if (!isCustomEntry(entry)) {
				continue;
			}

			if (entry.customType === approvalEntryType && isApprovalData(entry.data) && !this.consumedNonces.has(entry.data.nonce)) {
				byNonce.set(entry.data.nonce, entry.data);
			}

			if (entry.customType === consumptionEntryType && isConsumptionData(entry.data)) {
				this.consumedNonces.add(entry.data.nonce);
				if (byNonce.delete(entry.data.nonce)) {
					this.consumed += 1;
				}
			}
		}

		// eslint-disable-next-line unicorn/prefer-iterator-to-array -- Iterator#toArray needs a newer lib than the project targets.
		this.pending = [...byNonce.values()];
	}

	snapshot(now: number): LedgerSnapshot {
		return {
			pending: this.pending.filter(approval => approval.expiresAt > now).map(approval => approval.toolName),
			consumed: this.consumed,
		};
	}
}

function isApprovalData(data: unknown): data is PendingApproval {
	return isRecord(data)
		&& typeof data.nonce === 'string'
		&& typeof data.toolName === 'string'
		&& typeof data.inputJson === 'string'
		&& typeof data.cwd === 'string'
		&& typeof data.approvedAction === 'string'
		&& typeof data.expiresAt === 'number';
}

function isConsumptionData(data: unknown): data is {nonce: string} {
	return isRecord(data) && typeof data.nonce === 'string';
}
