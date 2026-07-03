import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {RuntimeState} from './runtime-state.ts';

export const reviewLogEntryType = 'agent-review-log';

export type ReviewLogData = {
	message: string;
};

type WidgetContext = {
	hasUI: boolean;
	ui: {setWidget(key: string, content: string[] | undefined, options?: {placement?: 'aboveEditor' | 'belowEditor'}): void};
};

const widgetKey = 'agent-review-log';
const maxWidgetLines = 3;
const headlineLimit = 100;

function headline(message: string): string {
	const firstLine = message.split('\n', 1)[0] ?? message;
	return firstLine.length <= headlineLimit ? firstLine : `${firstLine.slice(0, headlineLimit)}…`;
}

export function appendReviewLog(pi: ExtensionAPI, state: RuntimeState, context: WidgetContext, message: string): void {
	pi.appendEntry<ReviewLogData>(reviewLogEntryType, {message});

	if (!context.hasUI) {
		return;
	}

	state.recentReviewHeadlines.push(headline(message));
	if (state.recentReviewHeadlines.length > maxWidgetLines) {
		state.recentReviewHeadlines.shift();
	}

	context.ui.setWidget(
		widgetKey,
		state.recentReviewHeadlines.map(line => `Agent Review · ${line}`),
		{placement: 'belowEditor'},
	);
}
