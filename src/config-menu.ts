import {DynamicBorder} from '@earendil-works/pi-coding-agent';
import {Container, Spacer, Text} from '@earendil-works/pi-tui';
import type {AgentReviewConfig, ReviewScope} from './config.ts';

type Toggle = {
	key: 'reviewInput' | 'reviewOutput';
	label: string;
	description: string;
};

const toggles: Toggle[] = [
	{key: 'reviewInput', label: 'Review tool inputs', description: 'Review each proposed tool call before it runs'},
	{key: 'reviewOutput', label: 'Review tool outputs', description: 'Review tool output for sensitive data after it runs'},
];

type KeybindingsLike = {
	matches(data: string, action: string): boolean;
};

type Theme = {fg(role: string, text: string): string};

type UiContext = {
	ui: {
		custom<T>(render: (tui: {requestRender(): void}, theme: Theme, keybindings: KeybindingsLike, done: (value: T) => void) => {render(width: number): string[]; invalidate(): void; handleInput(data: string): void}): Promise<T>;
	};
};

type Scope = Required<ReviewScope>;

function readToggle(scope: Scope, key: Toggle['key']): boolean {
	return key === 'reviewInput' ? scope.reviewInput : scope.reviewOutput;
}

function flipToggle(scope: Scope, key: Toggle['key']): void {
	if (key === 'reviewInput') {
		scope.reviewInput = !scope.reviewInput;
	} else {
		scope.reviewOutput = !scope.reviewOutput;
	}
}

function renderMenu(listContainer: Container, scope: Scope, selectedIndex: number, theme: Theme): void {
	listContainer.clear();
	for (const [index, toggle] of toggles.entries()) {
		const isSelected = index === selectedIndex;
		const prefix = isSelected ? theme.fg('accent', '→ ') : '  ';
		const label = isSelected ? theme.fg('accent', toggle.label) : toggle.label;
		const state = readToggle(scope, toggle.key) ? theme.fg('success', 'on') : theme.fg('muted', 'off');
		listContainer.addChild(new Text(`${prefix}[${state}] ${label}`, 0, 0));
	}

	listContainer.addChild(new Spacer(1));
	listContainer.addChild(new Text(theme.fg('muted', `  ${toggles[selectedIndex].description}`), 0, 0));
}

// Interactive toggle menu for which review stages are enabled. Returns the chosen
// scope, or undefined if the user cancels without changing anything.
export async function openConfigMenu(context: UiContext, config: AgentReviewConfig): Promise<ReviewScope | undefined> {
	const scope: Scope = {
		reviewInput: config.review.reviewInput,
		reviewOutput: config.review.reviewOutput,
	};

	return context.ui.custom<ReviewScope | undefined>((tui, theme, keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder());
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg('muted', 'Up/down to move, enter to toggle, esc to save and close.'), 0, 0));
		container.addChild(new Spacer(1));

		const listContainer = new Container();
		container.addChild(listContainer);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());

		let selectedIndex = 0;
		renderMenu(listContainer, scope, selectedIndex, theme);
		tui.requestRender();

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (keybindings.matches(data, 'tui.select.up')) {
					selectedIndex = (selectedIndex === 0 ? toggles.length : selectedIndex) - 1;
				} else if (keybindings.matches(data, 'tui.select.down')) {
					selectedIndex = selectedIndex === toggles.length - 1 ? 0 : selectedIndex + 1;
				} else if (keybindings.matches(data, 'tui.select.confirm')) {
					flipToggle(scope, toggles[selectedIndex].key);
				} else if (keybindings.matches(data, 'tui.select.cancel')) {
					done(scope);
					return;
				}

				renderMenu(listContainer, scope, selectedIndex, theme);
				tui.requestRender();
			},
		};
	});
}
