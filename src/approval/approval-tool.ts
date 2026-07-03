import {randomUUID} from 'node:crypto';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {stringify} from 'safe-stable-stringify';
import {Type} from 'typebox';
import {neutralizeFence} from '../review/normalize-tool-call.ts';
import {classifyToolCall} from './approval-gate.ts';
import {
	approvalEntryType,
	approvalTtlMs,
	type ApprovalLedger,
} from './approval-ledger.ts';

export const approvalToolName = 'request_user_approval';

function sanitizeDialogText(text: string, maxChars: number): string {
	const flattened = neutralizeFence(text.replaceAll(/\s+/gv, ' ').trim());
	return flattened.length <= maxChars ? flattened : `${flattened.slice(0, maxChars)}…`;
}

type ToolResult = {content: Array<{type: 'text'; text: string}>; details: undefined};

function textResult(text: string): ToolResult {
	return {content: [{type: 'text', text}], details: undefined};
}

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
		async execute(toolCallId, params, signal, onUpdate, context) {
			const gate = classifyToolCall({toolName: params.toolName, input: params.input, cwd: context.cwd});
			if (gate.action === 'deny') {
				return textResult(`Approval cannot be requested: ${gate.reason} This action is categorically blocked and user approval cannot override it. Do not ask again or pursue it another way.`);
			}

			if (!context.hasUI) {
				return textResult('No interactive UI is available, so user approval cannot be requested. Stop and ask the user directly.');
			}

			const serializedInput = stringify(params.input) ?? 'null';
			const safeToolName = sanitizeDialogText(params.toolName, 60);
			const safeReason = sanitizeDialogText(params.reason, 300);
			const isApproved = await context.ui.confirm(
				`Agent Review: approve ${safeToolName}?`,
				`Tool: ${safeToolName}\nCwd: ${context.cwd}\nArgs: ${serializedInput}\n\nAgent's stated reason (unverified): ${safeReason}`,
			);

			if (!isApproved) {
				return textResult(`User declined ${params.toolName}. Do not retry it or pursue the same outcome another way; continue with a safer alternative or stop.`);
			}

			const approval = {
				nonce: randomUUID(),
				toolName: params.toolName,
				inputJson: serializedInput,
				cwd: context.cwd,
				approvedAction: `Tool: ${params.toolName}\nInput: ${serializedInput}\nReason: ${safeReason}`,
				expiresAt: Date.now() + approvalTtlMs,
			};
			ledger.record(approval);
			pi.appendEntry(approvalEntryType, approval);
			return textResult(`User approved ${params.toolName}. Retry now with the same intent; this authorizes exactly one execution of that action and expires shortly.`);
		},
	});
}
