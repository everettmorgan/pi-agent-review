import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {ApprovalLedger} from './approval/approval-ledger.ts';
import {registerApprovalTool} from './approval/approval-tool.ts';
import {createAgentReviewCommand} from './command.ts';
import {configPath, defaultConfig, loadConfigFromPath} from './config.ts';
import {DenialTracker} from './denial-tracker.ts';
import {registerReviewLog} from './review-log.ts';
import {createRuntimeState} from './runtime-state.ts';
import {createToolCallHandler} from './tool-call-handler.ts';
import {createToolResultHandler} from './tool-result-handler.ts';

export default function agentReview(pi: ExtensionAPI): void {
	const state = createRuntimeState();
	const ledger = new ApprovalLedger();

	pi.on('session_start', (event, context) => {
		if (event.reason === 'new' || event.reason === 'resume') {
			state.isReviewEnabled = true;
		}

		ledger.restoreFromBranch(context.sessionManager.getBranch());
	});

	pi.on('session_tree', (_event, context) => {
		ledger.restoreFromBranch(context.sessionManager.getBranch());
	});

	pi.on('turn_start', async () => {
		const config = await loadConfigFromPath(configPath);
		state.tracker = new DenialTracker((config.ok ? config.value : defaultConfig).review);
	});

	registerReviewLog(pi);
	registerApprovalTool(pi, ledger);
	pi.on('tool_call', createToolCallHandler(pi, state, ledger));
	pi.on('tool_result', createToolResultHandler(pi, state));

	pi.registerCommand('agent-review', createAgentReviewCommand(state, ledger));
}
