import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {buildTrustedIntentContext, formatTrustedIntentContext} from './approval-context.ts';
import {
	configPath,
	loadConfigFromPath,
	setReviewerModel,
} from './config.ts';
import {DenialTracker} from './denial-tracker.ts';
import {openModelPicker} from './model-picker.ts';
import {classifyToolCall} from './approval-gate.ts';
import {
	ApprovalLedger,
	approvalEntryType,
	computeArgsHash,
	consumptionEntryType,
} from './approval-ledger.ts';
import {normalizeToolCall} from './normalize-tool-call.ts';
import {formatDenialReason, formatReviewerFailureReason} from './review-decision.ts';
import {runReviewer} from './reviewer.ts';
import {
	agentReviewStateEntryType,
	defaultSessionReviewState,
	getReviewStateFromBranch,
	makeReviewStateEntryData,
} from './session-state.ts';
import {compactTranscript} from './transcript.ts';

type LastDecision = {
	toolName: string;
	decision: 'approve' | 'deny' | 'failure';
	rationale: string;
	cost: number;
	saferAlternative?: string;
};

function formatCost(cost: number): string {
	return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

function formatApproval(toolName: string, rationale: string, cost: number): string {
	return [
		`Approved: ${toolName}`,
		'',
		rationale,
		'',
		`Cost: ${formatCost(cost)}`,
	].join('\n');
}

function formatDenial(toolName: string, rationale: string, cost: number, saferAlternative?: string): string {
	const lines = [
		`Denied: ${toolName}`,
		'',
		rationale,
	];
	if (saferAlternative !== undefined) {
		lines.push('', `Alternative: ${saferAlternative}`);
	}

	lines.push('', `Cost: ${formatCost(cost)}`);
	return lines.join('\n');
}

function formatFailure(toolName: string, error: string, cost: number): string {
	return [
		`Failed: ${toolName}`,
		'',
		error,
		'',
		`Cost: ${formatCost(cost)}`,
	].join('\n');
}

export default function agentReview(pi: ExtensionAPI): void {
	let tracker = new DenialTracker({consecutiveDenialLimit: 3, rollingDenialLimit: 10});
	let lastDecision: LastDecision | undefined;
	let sessionReviewState = defaultSessionReviewState;
	const ledger = new ApprovalLedger();
	let sessionCost = 0;

	pi.on('session_start', (_event, context) => {
		sessionReviewState = getReviewStateFromBranch(context.sessionManager.getBranch());
		ledger.restoreFromBranch(context.sessionManager.getBranch());
	});

	pi.on('session_tree', (_event, context) => {
		sessionReviewState = getReviewStateFromBranch(context.sessionManager.getBranch());
		ledger.restoreFromBranch(context.sessionManager.getBranch());
	});

	pi.on('turn_start', async () => {
		const config = await loadConfigFromPath(configPath);
		const limits = config.ok ? config.value.review : {consecutiveDenialLimit: 3, rollingDenialLimit: 10};
		tracker = new DenialTracker(limits);
		sessionCost = 0;
	});

	pi.on('tool_call', async (event, context) => {
		const configResult = await loadConfigFromPath(configPath);
		if (!configResult.ok) {
			lastDecision = undefined;
			return {block: true, reason: formatReviewerFailureReason(configResult.error)};
		}

		if (!sessionReviewState.isReviewEnabled) {
			lastDecision = undefined;
			return;
		}

		const request = normalizeToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd});
		const argsHash = computeArgsHash(event.toolName, event.input, context.cwd);
		const gateResult = classifyToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd});

		if (gateResult.action === 'deny') {
			lastDecision = undefined;
			return {block: true, reason: `Agent Review blocked this tool call: ${gateResult.reason}`};
		}

		if (gateResult.action === 'require_approval') {
			if (!context.hasUI) {
				return {block: true, reason: `Agent Review requires approval for ${event.toolName}: ${gateResult.reason}. Run in interactive mode to approve.`};
			}

			const isApproved = await context.ui.confirm(
				`Agent Review: ${event.toolName}`,
				`${gateResult.reason}\n\nTool: ${event.toolName}\nCwd: ${context.cwd}\nArgs: ${request.argumentsJson.slice(0, 500)}`,
			);

			if (!isApproved) {
				lastDecision = undefined;
				return {block: true, reason: `User denied ${event.toolName} via approval gate.`};
			}

			ledger.record({argsHash});
			pi.appendEntry(approvalEntryType, {argsHash, oneShot: true});
		}

		const approvalState = ledger.consume(argsHash)
			? {status: 'approved_by_user' as const, argsHash}
			: undefined;
		if (approvalState !== undefined) {
			pi.appendEntry(consumptionEntryType, {argsHash});
		}

		const branch = context.sessionManager.getBranch();
		const trustedIntent = formatTrustedIntentContext(buildTrustedIntentContext(branch));
		const transcript = compactTranscript(context.sessionManager, {maxEntries: 30, maxChars: 20_000});
		const normalizedRequest = approvalState === undefined
			? request
			: normalizeToolCall({toolName: event.toolName, input: event.input, cwd: context.cwd}, {approval: approvalState, argsHash});
		const review = await runReviewer(context, configResult.value, normalizedRequest, trustedIntent, transcript);

		sessionCost += review.cost;

		if (!review.ok) {
			lastDecision = {
				toolName: event.toolName, decision: 'failure', rationale: review.error, cost: review.cost,
			};
			const circuit = tracker.recordDenied();
			context.ui.notify(formatFailure(event.toolName, review.error, review.cost), 'error');
			return {block: true, reason: circuit.tripped ? `${formatReviewerFailureReason(review.error)} ${circuit.reason ?? ''}` : `${formatReviewerFailureReason(review.error)} Review cost: ${formatCost(review.cost)}.`};
		}

		if (review.value.decision === 'deny') {
			lastDecision = {
				toolName: event.toolName,
				decision: 'deny',
				rationale: review.value.rationale,
				cost: review.cost,
				...((review.value.saferAlternative !== undefined) && {saferAlternative: review.value.saferAlternative}),
			};
			const circuit = tracker.recordDenied();
			const base = formatDenialReason(review.value);
			context.ui.notify(formatDenial(event.toolName, review.value.rationale, review.cost, review.value.saferAlternative), 'warning');
			return {block: true, reason: circuit.tripped ? `${base} ${circuit.reason ?? ''}` : `${base} Review cost: ${formatCost(review.cost)}.`};
		}

		tracker.recordApproved();
		lastDecision = {
			toolName: event.toolName, decision: 'approve', rationale: review.value.rationale, cost: review.cost,
		};
		context.ui.notify(formatApproval(event.toolName, review.value.rationale, review.cost), 'info');
	});

	pi.registerCommand('agent-review', {
		description: 'Show Agent Review status or test a tool call review.',
		async handler(commandArguments, context) {
			const trimmed = commandArguments.trim();

			if (trimmed === 'on' || trimmed === 'off') {
				const isEnabled = trimmed === 'on';
				sessionReviewState = makeReviewStateEntryData(isEnabled);
				pi.appendEntry(agentReviewStateEntryType, sessionReviewState);
				context.ui.notify(`Agent Review ${isEnabled ? 'enabled' : 'disabled'} for this session.`, 'info');
				return;
			}

			const config = await loadConfigFromPath(configPath);

			if (trimmed === 'model' || trimmed.startsWith('model ')) {
				if (trimmed === 'model') {
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

					const result = await setReviewerModel(configPath, choice);
					if (!result.ok) {
						context.ui.notify(`Agent Review: ${result.error}`, 'error');
						return;
					}

					context.ui.notify(`Reviewer model set to ${result.value.reviewer.provider}/${result.value.reviewer.model}.`, 'info');
					return;
				}

				const spec = trimmed.slice('model '.length).trim();
				const result = await setReviewerModel(configPath, spec);
				if (!result.ok) {
					context.ui.notify(`Agent Review: ${result.error}`, 'error');
					return;
				}

				context.ui.notify(`Reviewer model set to ${result.value.reviewer.provider}/${result.value.reviewer.model}.`, 'info');
				return;
			}

			if (trimmed.startsWith('test ')) {
				if (!config.ok) {
					context.ui.notify(`Agent Review config error: ${config.error}`, 'error');
					return;
				}

				const raw = trimmed.slice('test '.length);
				const firstSpace = raw.indexOf(' ');
				if (firstSpace === -1) {
					context.ui.notify('Usage: /agent-review test <tool-name> <json-args>', 'error');
					return;
				}

				const toolName = raw.slice(0, firstSpace);
				const input = JSON.parse(raw.slice(firstSpace + 1)) as unknown;
				const request = normalizeToolCall({toolName, input, cwd: context.cwd});
				const argsHash = computeArgsHash(toolName, input, context.cwd);
				const requestWithHash = normalizeToolCall({toolName, input, cwd: context.cwd}, {argsHash});
				const branch = context.sessionManager.getBranch();
				const trustedIntent = formatTrustedIntentContext(buildTrustedIntentContext(branch));
				const transcript = compactTranscript(context.sessionManager, {maxEntries: 30, maxChars: 20_000});
				const review = await runReviewer(context, config.value, requestWithHash, trustedIntent, transcript);

				if (!review.ok) {
					context.ui.notify(formatFailure(toolName, review.error, review.cost), 'error');
					return;
				}

				if (review.value.decision === 'deny') {
					context.ui.notify(formatDenial(toolName, review.value.rationale, review.cost, review.value.saferAlternative), 'warning');
					return;
				}

				context.ui.notify(formatApproval(toolName, review.value.rationale, review.cost), 'info');
				return;
			}

			if (trimmed === '' || trimmed === 'status') {
				const snapshot = tracker.snapshot();
				const statusLines = [
					'Agent Review',
					'',
					`Config: ${configPath}`,
					`Valid: ${String(config.ok)}`,
				];
				if (config.ok) {
					statusLines.push(
						`Enabled for session: ${String(sessionReviewState.isReviewEnabled)}`,
						`Reviewer: ${config.value.reviewer.provider}/${config.value.reviewer.model}`,
					);
				} else {
					statusLines.push(`Error: ${config.error}`);
				}

				statusLines.push(
					'',
					`Consecutive denials: ${String(snapshot.consecutiveDenials)}`,
					`Rolling denials: ${String(snapshot.rollingDenials)}`,
					`Session cost: ${formatCost(sessionCost)}`,
				);

				if (lastDecision !== undefined) {
					statusLines.push(
						'',
						'---',
						'',
						'Last decision:',
						`Tool: ${lastDecision.toolName}`,
						`Decision: ${lastDecision.decision}`,
						`Reasoning: ${lastDecision.rationale}`,
					);
					if (lastDecision.saferAlternative !== undefined) {
						statusLines.push(`Alternative: ${lastDecision.saferAlternative}`);
					}

					statusLines.push(`Cost: ${formatCost(lastDecision.cost)}`);
				}

				context.ui.notify(statusLines.join('\n'), config.ok ? 'info' : 'error');
				return;
			}

			context.ui.notify('Usage: /agent-review status | /agent-review on | /agent-review off | /agent-review model [current|provider/model] | /agent-review test <tool-name> <json-args>', 'error');
		},
	});
}
