import type {AgentReviewConfig} from './config.ts';
import {isModelSupportingTools} from './review/tool-support.ts';

type PickerModel = {provider: string; id: string; api?: string};

type UiContext = {
	modelRegistry: {getAvailable(): PickerModel[]};
	ui: {select(title: string, options: string[]): Promise<string | undefined>};
};

const currentOption = 'current (use the active session model)';

function specsFor(models: PickerModel[]): string[] {
	return models.map(model => `${model.provider}/${model.id}`);
}

export async function openModelPicker(context: UiContext, config: AgentReviewConfig): Promise<string | undefined> {
	const available = context.modelRegistry.getAvailable();
	const toolCapable = available.filter(model => isModelSupportingTools(model));
	const specs = specsFor(toolCapable.length > 0 ? toolCapable : available);
	const options = [currentOption, ...specs];

	const choice = await context.ui.select(`Reviewer model (now: ${config.reviewer.provider}/${config.reviewer.model})`, options);
	return choice === currentOption ? 'current' : choice;
}
