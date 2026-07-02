import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {stringify} from 'safe-stable-stringify';
import {Type} from 'typebox';
import {approvalEntryType, computeArgsHash, type ApprovalLedger} from './approval-ledger.ts';
import {truncateText} from './normalize-tool-call.ts';

export const approvalToolName = 'request_user_approval';

const displayArgumentLimit = 500;

export function registerApprovalTool(pi: ExtensionAPI, ledger: ApprovalLedger): void {
	pi.registerTool({
		name: approvalToolName,
		label: 'Request user approval',
		description: 'Ask the user to confirm a tool call that Agent Review denied. Pass the exact tool name and input you intend to run, unchanged. If the user approves, retry the identical tool call.',
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

			const serializedInput = truncateText(stringify(params.input) ?? 'null', displayArgumentLimit);
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

			const argsHash = computeArgsHash(params.toolName, params.input, context.cwd);
			ledger.record({argsHash});
			pi.appendEntry(approvalEntryType, {argsHash, oneShot: true});
			return {
				content: [{type: 'text', text: `User approved ${params.toolName} (argsHash: ${argsHash}). Retry the identical tool call now; the approval is one-shot and only matches the exact same tool name and input.`}],
				details: undefined,
			};
		},
	});
}
