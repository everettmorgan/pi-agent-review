import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {ApprovalLedger} from './approval-ledger.ts';
import {registerApprovalTool} from './approval-tool.ts';
import {createAgentReviewCommand} from './command.ts';
import {configPath, defaultConfig, loadConfigFromPath} from './config.ts';
import {DenialTracker} from './denial-tracker.ts';
import {createRuntimeState} from './runtime-state.ts';
import {getReviewStateFromBranch} from './session-state.ts';
import {createToolCallHandler} from './tool-call-handler.ts';

export default function agentReview(pi: ExtensionAPI): void {
	const state = createRuntimeState();
	const ledger = new ApprovalLedger();

	const syncFromBranch = (branch: unknown[]) => {
		state.reviewState = getReviewStateFromBranch(branch);
		ledger.restoreFromBranch(branch);
	};

	pi.on('session_start', (_event, context) => {
		syncFromBranch(context.sessionManager.getBranch());
	});

	pi.on('session_tree', (_event, context) => {
		syncFromBranch(context.sessionManager.getBranch());
	});

	pi.on('turn_start', async () => {
		const config = await loadConfigFromPath(configPath);
		state.tracker = new DenialTracker(config.ok ? config.value.review : defaultConfig.review);
		state.sessionCost = 0;
	});

	registerApprovalTool(pi, ledger);
	pi.on('tool_call', createToolCallHandler(pi, state, ledger));

	pi.registerCommand('agent-review', createAgentReviewCommand(pi, state));
}
