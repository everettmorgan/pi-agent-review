import {describe, expect, it, vi} from 'vitest';
import {ApprovalLedger, computeArgsHash} from '../approval-ledger.ts';
import {approvalToolName, registerApprovalTool} from '../approval-tool.ts';

function setup() {
	const ledger = new ApprovalLedger();
	let tool: any;
	const pi = {
		registerTool: vi.fn(definition => {
			tool = definition;
		}),
		appendEntry: vi.fn(),
	} as any;
	registerApprovalTool(pi, ledger);
	return {pi, ledger, tool};
}

const params = {toolName: 'bash', input: {command: 'npm install left-pad'}, reason: 'Install dependency'};

async function execute(tool: any, context: unknown) {
	return tool.execute('call-1', params, undefined, undefined, context);
}

describe('registerApprovalTool', () => {
	it('registers the tool under the expected name', () => {
		const {tool} = setup();
		expect(tool.name).toBe(approvalToolName);
	});

	it('records a one-shot ledger approval when the user confirms', async () => {
		const {pi, ledger, tool} = setup();
		const context = {cwd: '/repo', hasUI: true, ui: {confirm: vi.fn().mockResolvedValue(true)}};

		const result = await execute(tool, context);

		const argsHash = computeArgsHash(params.toolName, params.input, '/repo');
		expect(ledger.hasPending(argsHash)).toBe(true);
		expect(pi.appendEntry).toHaveBeenCalledWith('agent-review-approval', {argsHash, oneShot: true});
		expect(result.content[0].text).toContain('User approved bash');
	});

	it('records nothing when the user declines', async () => {
		const {pi, ledger, tool} = setup();
		const context = {cwd: '/repo', hasUI: true, ui: {confirm: vi.fn().mockResolvedValue(false)}};

		const result = await execute(tool, context);

		expect(ledger.hasPending(computeArgsHash(params.toolName, params.input, '/repo'))).toBe(false);
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(result.content[0].text).toContain('User declined');
	});

	it('reports when no interactive UI is available', async () => {
		const {tool} = setup();

		const result = await execute(tool, {cwd: '/repo', hasUI: false});

		expect(result.content[0].text).toContain('cannot be requested');
	});
});
