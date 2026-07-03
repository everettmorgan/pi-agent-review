import type {AgentReviewConfig, ReviewScope} from './config.ts';

type UiContext = {
	ui: {select(title: string, options: string[]): Promise<string | undefined>};
};

const doneOption = 'Done';

function toggleOptions(scope: Required<ReviewScope>): string[] {
	return [
		`Review tool inputs: ${scope.reviewInput ? 'on' : 'off'} (press enter to toggle)`,
		`Review tool outputs: ${scope.reviewOutput ? 'on' : 'off'} (press enter to toggle)`,
		doneOption,
	];
}

export async function openConfigMenu(context: UiContext, config: AgentReviewConfig): Promise<ReviewScope | undefined> {
	const scope = {reviewInput: config.review.reviewInput, reviewOutput: config.review.reviewOutput};

	for (;;) {
		const options = toggleOptions(scope);
		// eslint-disable-next-line no-await-in-loop
		const choice = await context.ui.select('Agent Review stages', options);
		if (choice === undefined || choice === doneOption) {
			return scope;
		}

		if (choice === options[0]) {
			scope.reviewInput = !scope.reviewInput;
		} else {
			scope.reviewOutput = !scope.reviewOutput;
		}
	}
}
