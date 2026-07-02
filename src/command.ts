import type {
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from '@earendil-works/pi-coding-agent';
import {
	configPath,
	loadConfigFromPath,
	setReviewerModel,
	setReviewScope,
	type ConfigResult,
} from './config.ts';
import {openConfigMenu} from './config-menu.ts';
import {openModelPicker} from './model-picker.ts';
import {errorMessage} from './shared/guards.ts';
import {normalizeToolCall} from './review/normalize-tool-call.ts';
import {formatCost, formatOutcome, performReview} from './review/run-review.ts';
import type {RuntimeState} from './runtime-state.ts';
import {agentReviewStateEntryType, makeReviewStateEntryData} from './session-state.ts';

const usage = 'Usage: /agent-review status | on | off | config | input on|off | output on|off | model [current|provider/model] | test <tool-name> <json-args>';

function handleToggle(pi: ExtensionAPI, state: RuntimeState, context: ExtensionCommandContext, isEnabled: boolean): void {
	state.reviewState = makeReviewStateEntryData(isEnabled);
	pi.appendEntry(agentReviewStateEntryType, state.reviewState);
	context.ui.notify(`Agent Review ${isEnabled ? 'enabled' : 'disabled'} for this session.`, 'info');
}

async function handleModel(context: ExtensionCommandContext, config: ConfigResult, spec: string): Promise<void> {
	if (spec === '') {
		await showOrPickModel(context, config);
		return;
	}

	await applyModelSpec(context, spec);
}

// With no spec: outside a TUI just report the current model; inside a TUI open
// the picker and apply the chosen model.
async function showOrPickModel(context: ExtensionCommandContext, config: ConfigResult): Promise<void> {
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
	if (choice !== undefined) {
		await applyModelSpec(context, choice);
	}
}

async function applyModelSpec(context: ExtensionCommandContext, spec: string): Promise<void> {
	const result = await setReviewerModel(configPath, spec);
	if (result.ok) {
		context.ui.notify(`Reviewer model set to ${result.value.reviewer.provider}/${result.value.reviewer.model}.`, 'info');
	} else {
		context.ui.notify(`Agent Review: ${result.error}`, 'error');
	}
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

	const request = normalizeToolCall({toolName, input, cwd: context.cwd});
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

async function applyScope(context: ExtensionCommandContext, scope: {reviewInput?: boolean; reviewOutput?: boolean}): Promise<void> {
	const result = await setReviewScope(configPath, scope);
	if (result.ok) {
		context.ui.notify(`Review inputs: ${String(result.value.review.reviewInput)}, review outputs: ${String(result.value.review.reviewOutput)}.`, 'info');
	} else {
		context.ui.notify(`Agent Review: ${result.error}`, 'error');
	}
}

async function handleScope(context: ExtensionCommandContext, stage: 'reviewInput' | 'reviewOutput', argument: string): Promise<void> {
	if (argument !== 'on' && argument !== 'off') {
		context.ui.notify(`Usage: /agent-review ${stage === 'reviewInput' ? 'input' : 'output'} on|off`, 'error');
		return;
	}

	await applyScope(context, {[stage]: argument === 'on'});
}

async function handleConfig(context: ExtensionCommandContext, config: ConfigResult): Promise<void> {
	if (!config.ok) {
		context.ui.notify(`Agent Review config error: ${config.error}`, 'error');
		return;
	}

	if (context.mode !== 'tui') {
		context.ui.notify('Open /agent-review config in interactive mode, or use /agent-review input|output on|off.', 'error');
		return;
	}

	const scope = await openConfigMenu(context, config.value);
	if (scope !== undefined) {
		await applyScope(context, scope);
	}
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
			`Review inputs: ${String(config.value.review.reviewInput)}`,
			`Review outputs: ${String(config.value.review.reviewOutput)}`,
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

			if (trimmed === 'input' || trimmed.startsWith('input ')) {
				await handleScope(context, 'reviewInput', trimmed.slice('input'.length).trim());
				return;
			}

			if (trimmed === 'output' || trimmed.startsWith('output ')) {
				await handleScope(context, 'reviewOutput', trimmed.slice('output'.length).trim());
				return;
			}

			if (trimmed === 'config') {
				await handleConfig(context, config);
				return;
			}

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
