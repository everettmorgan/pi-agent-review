import type {
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from '@earendil-works/pi-coding-agent';
import {
	configPath,
	loadConfigFromPath,
	setReviewerModel,
	type ConfigResult,
} from './config.ts';
import {openModelPicker} from './model-picker.ts';
import {computeArgsHash} from './approval/approval-ledger.ts';
import {errorMessage} from './shared/guards.ts';
import {normalizeToolCall} from './review/normalize-tool-call.ts';
import {formatCost, formatOutcome, performReview} from './review/run-review.ts';
import type {RuntimeState} from './runtime-state.ts';
import {agentReviewStateEntryType, makeReviewStateEntryData} from './session-state.ts';

const usage = 'Usage: /agent-review status | /agent-review on | /agent-review off | /agent-review model [current|provider/model] | /agent-review test <tool-name> <json-args>';

function handleToggle(pi: ExtensionAPI, state: RuntimeState, context: ExtensionCommandContext, isEnabled: boolean): void {
	state.reviewState = makeReviewStateEntryData(isEnabled);
	pi.appendEntry(agentReviewStateEntryType, state.reviewState);
	context.ui.notify(`Agent Review ${isEnabled ? 'enabled' : 'disabled'} for this session.`, 'info');
}

async function handleModel(context: ExtensionCommandContext, config: ConfigResult, spec: string): Promise<void> {
	if (spec === '') {
		if (context.mode !== 'tui') {
			context.ui.notify(
				config.ok
					? `Agent Review reviewer model: ${config.value.reviewer.provider}/${config.value.reviewer.model}`
					: `Agent Review config error: ${config.error}`,
				config.ok ? 'info' : 'error',
			);
			return;
		}

		if (!config.ok) {
			context.ui.notify(`Agent Review config error: ${config.error}`, 'error');
			return;
		}

		const choice = await openModelPicker(context, config.value);
		if (choice === undefined) {
			return;
		}

		spec = choice;
	}

	const result = await setReviewerModel(configPath, spec);
	if (!result.ok) {
		context.ui.notify(`Agent Review: ${result.error}`, 'error');
		return;
	}

	context.ui.notify(`Reviewer model set to ${result.value.reviewer.provider}/${result.value.reviewer.model}.`, 'info');
}

async function handleTest(context: ExtensionCommandContext, config: ConfigResult, raw: string): Promise<void> {
	if (!config.ok) {
		context.ui.notify(`Agent Review config error: ${config.error}`, 'error');
		return;
	}

	const firstSpace = raw.indexOf(' ');
	if (firstSpace === -1) {
		context.ui.notify('Usage: /agent-review test <tool-name> <json-args>', 'error');
		return;
	}

	const toolName = raw.slice(0, firstSpace);
	let input: unknown;
	try {
		input = JSON.parse(raw.slice(firstSpace + 1));
	} catch (error: unknown) {
		context.ui.notify(`Agent Review: invalid JSON args: ${errorMessage(error)}`, 'error');
		return;
	}

	const argsHash = computeArgsHash(toolName, input, context.cwd);
	const request = normalizeToolCall({toolName, input, cwd: context.cwd}, {argsHash});
	const review = await performReview(context, config.value, request);

	if (!review.ok) {
		context.ui.notify(formatOutcome('Failed', toolName, review.error, review.cost), 'error');
		return;
	}

	if (review.value.decision === 'deny') {
		context.ui.notify(formatOutcome('Denied', toolName, review.value.rationale, review.cost, review.value.saferAlternative), 'warning');
		return;
	}

	context.ui.notify(formatOutcome('Approved', toolName, review.value.rationale, review.cost), 'info');
}

function renderStatus(state: RuntimeState, config: ConfigResult): string {
	const snapshot = state.tracker.snapshot();
	const statusLines = [
		'Agent Review',
		'',
		`Config: ${configPath}`,
		`Valid: ${String(config.ok)}`,
	];
	if (config.ok) {
		statusLines.push(
			`Enabled for session: ${String(state.reviewState.isReviewEnabled)}`,
			`Reviewer: ${config.value.reviewer.provider}/${config.value.reviewer.model}`,
		);
	} else {
		statusLines.push(`Error: ${config.error}`);
	}

	statusLines.push(
		'',
		`Consecutive denials: ${String(snapshot.consecutiveDenials)}`,
		`Rolling denials: ${String(snapshot.rollingDenials)}`,
		`Session cost: ${formatCost(state.sessionCost)}`,
	);

	const {lastDecision} = state;
	if (lastDecision !== undefined) {
		statusLines.push(
			'',
			'---',
			'',
			'Last request review:',
			`Tool: ${lastDecision.toolName}`,
			`Decision: ${lastDecision.decision}`,
			`Reasoning: ${lastDecision.rationale}`,
		);
		if (lastDecision.saferAlternative !== undefined) {
			statusLines.push(`Alternative: ${lastDecision.saferAlternative}`);
		}

		statusLines.push(`Cost: ${formatCost(lastDecision.cost)}`);
	}

	const {lastOutputReview} = state;
	if (lastOutputReview !== undefined) {
		const categories = lastOutputReview.categories.length > 0 ? ` [${lastOutputReview.categories.join(', ')}]` : '';
		statusLines.push(
			'',
			'---',
			'',
			'Last output review:',
			`Tool: ${lastOutputReview.toolName}`,
			`Verdict: ${lastOutputReview.containsSensitive ? `blocked — sensitive data${categories}` : 'cleared'}`,
			`Reasoning: ${lastOutputReview.rationale}`,
			`Cost: ${formatCost(lastOutputReview.cost)}`,
		);
	}

	return statusLines.join('\n');
}

export function createAgentReviewCommand(pi: ExtensionAPI, state: RuntimeState): Omit<RegisteredCommand, 'name' | 'sourceInfo'> {
	return {
		description: 'Show Agent Review status or test a tool call review.',
		async handler(commandArguments, context) {
			const trimmed = commandArguments.trim();

			if (trimmed === 'on' || trimmed === 'off') {
				handleToggle(pi, state, context, trimmed === 'on');
				return;
			}

			const config = await loadConfigFromPath(configPath);

			if (trimmed === 'model' || trimmed.startsWith('model ')) {
				await handleModel(context, config, trimmed.slice('model'.length).trim());
				return;
			}

			if (trimmed.startsWith('test ')) {
				await handleTest(context, config, trimmed.slice('test '.length));
				return;
			}

			if (trimmed === '' || trimmed === 'status') {
				context.ui.notify(renderStatus(state, config), config.ok ? 'info' : 'error');
				return;
			}

			context.ui.notify(usage, 'error');
		},
	};
}
