import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {ApprovalLedger} from '../src/approval/approval-ledger.ts';
import {approvalToolName, registerApprovalTool} from '../src/approval/approval-tool.ts';

function setup() {
	const ledger = new ApprovalLedger();
	const appendEntry = vi.fn();
	let tool: ToolDefinition | undefined;
	const pi = {
		registerTool(definition: ToolDefinition) {
			tool = definition;
		},
		appendEntry,
	} as unknown as ExtensionAPI;
	registerApprovalTool(pi, ledger);
	if (tool === undefined) {
		throw new Error('tool was not registered');
	}

	return {appendEntry, ledger, tool};
}

const params = {toolName: 'bash', input: {command: 'npm install left-pad'}, reason: 'Install dependency'};

function makeContext(hasUi: boolean, confirmAnswer = false): unknown {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	return {cwd: '/repo', hasUI: hasUi, ui: {confirm: vi.fn().mockResolvedValue(confirmAnswer)}};
}

async function execute(tool: ToolDefinition, context: unknown) {
	return tool.execute('call-1', params, undefined, undefined, context as ExtensionContext);
}

describe('registerApprovalTool', () => {
	it('registers the tool under the expected name', () => {
		const {tool} = setup();
		expect(tool.name).toBe(approvalToolName);
	});

	it('records a unique, time-bound approval describing the action when the user confirms', async () => {
		const {appendEntry, ledger, tool} = setup();
		const result = await execute(tool, makeContext(true, true));

		const pending = ledger.findPendingForTool('bash', Date.now());
		expect(pending).toBeDefined();
		expect(pending?.nonce).toEqual(expect.any(String));
		expect(pending?.expiresAt).toBeGreaterThan(Date.now());
		expect(pending?.approvedAction).toContain('npm install left-pad');
		expect(pending?.approvedAction).toContain('Install dependency');
		expect(appendEntry).toHaveBeenCalledWith('agent-review-approval', pending);
		expect(result.content[0]).toMatchObject({text: expect.stringContaining('User approved bash') as string});
	});

	it('records nothing when the user declines', async () => {
		const {appendEntry, ledger, tool} = setup();
		const result = await execute(tool, makeContext(true, false));

		expect(ledger.findPendingForTool('bash', Date.now())).toBeUndefined();
		expect(appendEntry).not.toHaveBeenCalled();
		expect(result.content[0]).toMatchObject({text: expect.stringContaining('User declined') as string});
	});

	it('reports when no interactive UI is available', async () => {
		const {tool} = setup();

		const result = await execute(tool, makeContext(false));

		expect(result.content[0]).toMatchObject({text: expect.stringContaining('cannot be requested') as string});
	});
});
