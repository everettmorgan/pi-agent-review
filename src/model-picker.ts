import type {AgentReviewConfig} from './config.ts';
import {isModelSupportingTools} from './review/tool-support.ts';

type UiContext = {
	model?: {api?: string};
	modelRegistry: {getAvailable(): Array<{provider: string; id: string; name: string; api: string}>};
	ui: {select(title: string, options: string[]): Promise<string | undefined>};
};

const currentOption = 'current (use the active session model)';

export async function openModelPicker(context: UiContext, config: AgentReviewConfig): Promise<string | undefined> {
	const specs = context.modelRegistry
		.getAvailable()
		.filter(model => isModelSupportingTools(model))
		.map(model => `${model.provider}/${model.id}`);
	const hasToolSupport = context.model === undefined ? false : isModelSupportingTools(context.model);
	const options = hasToolSupport ? [currentOption, ...specs] : specs;

	const choice = await context.ui.select(`Reviewer model (now: ${config.reviewer.provider}/${config.reviewer.model})`, options);
	return choice === currentOption ? 'current' : choice;
}
