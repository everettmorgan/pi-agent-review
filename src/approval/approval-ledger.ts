import {isCustomEntry, isRecord} from '../shared/guards.ts';

export const approvalEntryType = 'agent-review-approval';
export const consumptionEntryType = 'agent-review-consumption';

export const approvalTtlMs = 10 * 60 * 1000;

export type PendingApproval = {
	nonce: string;
	toolName: string;
	inputJson: string;
	cwd: string;
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
	private readonly consumedNonces = new Set<string>();

	record(approval: PendingApproval): void {
		this.pending.push(approval);
	}

	findPendingForTool(toolName: string, now: number): PendingApproval | undefined {
		return this.pending.find(approval => approval.toolName === toolName && approval.expiresAt > now);
	}

	findExactMatch(toolName: string, inputJson: string, cwd: string, now: number): PendingApproval | undefined {
		return this.pending.find(approval =>
			approval.toolName === toolName
			&& approval.inputJson === inputJson
			&& approval.cwd === cwd
			&& approval.expiresAt > now);
	}

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
		const killedOnSight = new Set<string>();

		for (const entry of branch) {
			if (!isCustomEntry(entry)) {
				continue;
			}

			if (entry.customType === approvalEntryType && isApprovalData(entry.data)) {
				if (this.consumedNonces.has(entry.data.nonce)) {
					killedOnSight.add(entry.data.nonce);
				} else {
					byNonce.set(entry.data.nonce, entry.data);
				}
			}

			if (entry.customType === consumptionEntryType && isConsumptionData(entry.data)) {
				this.consumedNonces.add(entry.data.nonce);
				if (byNonce.delete(entry.data.nonce) || killedOnSight.has(entry.data.nonce)) {
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
