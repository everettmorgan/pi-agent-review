import {createHash} from 'node:crypto';
import {stringify} from 'safe-stable-stringify';

export const approvalEntryType = 'agent-review-approval';
export const consumptionEntryType = 'agent-review-consumption';

export type ApprovalRecord = {
	argsHash: string;
};

export type LedgerSnapshot = {
	pending: string[];
	consumed: number;
};

export function computeArgsHash(toolName: string, input: unknown, cwd: string): string {
	const payload = stringify({toolName, input, cwd}) ?? 'null';
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export class ApprovalLedger {
	private readonly pending = new Set<string>();
	private consumed = 0;

	record(approval: ApprovalRecord): void {
		this.pending.add(approval.argsHash);
	}

	hasPending(argsHash: string): boolean {
		return this.pending.has(argsHash);
	}

	consume(argsHash: string): boolean {
		if (!this.pending.has(argsHash)) {
			return false;
		}

		this.pending.delete(argsHash);
		this.consumed += 1;
		return true;
	}

	restoreFromBranch(branch: unknown[]): void {
		this.pending.clear();
		this.consumed = 0;
		const pendingSet = new Set<string>();

		for (const entry of branch) {
			if (!isCustomEntry(entry)) {
				continue;
			}

			if (entry.customType === approvalEntryType && isApprovalData(entry.data)) {
				pendingSet.add(entry.data.argsHash);
			}

			if (entry.customType === consumptionEntryType && isConsumptionData(entry.data)) {
				pendingSet.delete(entry.data.argsHash);
				this.consumed += 1;
			}
		}

		for (const hash of pendingSet) {
			this.pending.add(hash);
		}
	}

	snapshot(): LedgerSnapshot {
		return {pending: [...this.pending], consumed: this.consumed};
	}
}

function isCustomEntry(entry: unknown): entry is {type: string; customType: string; data: unknown} {
	return entry !== null
		&& typeof entry === 'object'
		&& !Array.isArray(entry)
		&& (entry as {type?: unknown}).type === 'custom'
		&& typeof (entry as {customType?: unknown}).customType === 'string';
}

function isApprovalData(data: unknown): data is {argsHash: string} {
	return data !== null
		&& typeof data === 'object'
		&& !Array.isArray(data)
		&& typeof (data as {argsHash?: unknown}).argsHash === 'string';
}

function isConsumptionData(data: unknown): data is {argsHash: string} {
	return isApprovalData(data);
}
