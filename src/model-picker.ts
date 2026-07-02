import {DynamicBorder} from '@earendil-works/pi-coding-agent';
import {
	Container,
	fuzzyFilter,
	Input,
	Spacer,
	Text,
} from '@earendil-works/pi-tui';
import type {AgentReviewConfig} from './config.ts';
import {isModelSupportingTools} from './review/tool-support.ts';

type ModelItem = {
	value: string;
	label: string;
	description: string;
};

type ModelRegistry = {
	getAvailable(): Array<{provider: string; id: string; name: string; api: string}>;
};

type KeybindingsLike = {
	matches(data: string, action: string): boolean;
};

type UiContext = {
	mode: string;
	model?: {api?: string};
	modelRegistry: ModelRegistry;
	ui: {
		custom<T>(render: (tui: {requestRender(): void}, theme: {fg(role: string, text: string): string}, keybindings: KeybindingsLike, done: (value: T) => void) => {render(width: number): string[]; invalidate(): void; handleInput(data: string): void}): Promise<T>;
		notify(message: string, level: 'info' | 'error'): void;
	};
};

function buildModelItems(available: Array<{provider: string; id: string; name: string}>, hasToolSupport: boolean): ModelItem[] {
	const items: ModelItem[] = [];

	if (hasToolSupport) {
		items.push({value: 'current', label: 'Current session model', description: 'Use the active session model for review'});
	}

	for (const model of available) {
		items.push({
			value: `${model.provider}/${model.id}`,
			label: model.id,
			description: model.name,
		});
	}

	return items;
}

function modelSearchText(item: ModelItem): string {
	return `${item.value} ${item.label} ${item.description}`;
}

function formatPagination(selectedIndex: number, totalItems: number): string {
	return `  (${String(selectedIndex + 1)}/${String(totalItems)})`;
}

function renderModelList(listContainer: Container, items: ModelItem[], selectedIndex: number, currentSpec: string, theme: {fg(role: string, text: string): string}): void {
	listContainer.clear();
	const maxVisible = 10;
	const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible));
	const endIndex = Math.min(startIndex + maxVisible, items.length);

	for (let index = startIndex; index < endIndex; index++) {
		const item = items[index];
		const isSelected = index === selectedIndex;
		const isCurrent = item.value === currentSpec;
		const prefix = isSelected ? theme.fg('accent', '→ ') : '  ';
		const label = isSelected ? theme.fg('accent', item.label) : item.label;
		const description = theme.fg('muted', item.value === 'current' ? '' : `[${item.value}]`);
		const checkmark = isCurrent ? theme.fg('success', ' ✓') : '';
		listContainer.addChild(new Text(`${prefix}${label} ${description}${checkmark}`, 0, 0));
	}

	if (startIndex > 0 || endIndex < items.length) {
		const paginationText = theme.fg('muted', formatPagination(selectedIndex, items.length));
		listContainer.addChild(new Text(paginationText, 0, 0));
	}

	if (items.length === 0) {
		listContainer.addChild(new Text(theme.fg('muted', '  No matching models'), 0, 0));
	} else {
		const selected = items[selectedIndex];
		listContainer.addChild(new Spacer(1));
		listContainer.addChild(new Text(theme.fg('muted', `  ${selected.description}`), 0, 0));
	}
}

export async function openModelPicker(context: UiContext, config: AgentReviewConfig): Promise<string | undefined> {
	const models = context.modelRegistry.getAvailable();
	const available = models.filter(isModelSupportingTools);
	const currentSpec = `${config.reviewer.provider}/${config.reviewer.model}`;
	const hasToolSupport = context.model === undefined ? false : isModelSupportingTools(context.model);
	const allItems = buildModelItems(available, hasToolSupport);

	return context.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder());
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg('muted', 'Type to search models. Only showing models from configured providers.'), 0, 0));
		container.addChild(new Spacer(1));

		const searchInput = new Input();
		container.addChild(searchInput);
		container.addChild(new Spacer(1));

		const listContainer = new Container();
		container.addChild(listContainer);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());

		let filteredItems = allItems;
		let selectedIndex = 0;

		function filterItems(query: string): void {
			filteredItems = query === '' ? allItems : fuzzyFilter(allItems, query, item => modelSearchText(item));
			selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));
			renderModelList(listContainer, filteredItems, selectedIndex, currentSpec, theme);
		}

		filterItems('');
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
					selectedIndex = (selectedIndex === 0 ? filteredItems.length : selectedIndex) - 1;
					renderModelList(listContainer, filteredItems, selectedIndex, currentSpec, theme);
				} else if (keybindings.matches(data, 'tui.select.down')) {
					selectedIndex = selectedIndex === filteredItems.length - 1 ? 0 : selectedIndex + 1;
					renderModelList(listContainer, filteredItems, selectedIndex, currentSpec, theme);
				} else if (keybindings.matches(data, 'tui.select.confirm')) {
					const selected = filteredItems.at(selectedIndex);
					if (selected === undefined) {
						return;
					}

					done(selected.value);
				} else if (keybindings.matches(data, 'tui.select.cancel')) {
					done(undefined);
				} else {
					searchInput.handleInput(data);
					filterItems(searchInput.getValue());
				}

				tui.requestRender();
			},
		};
	});
}
