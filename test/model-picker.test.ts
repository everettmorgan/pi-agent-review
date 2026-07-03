import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type {AgentReviewConfig} from '../src/config.ts';
import {openModelPicker} from '../src/model-picker.ts';

const config = {reviewer: {provider: 'openai-codex', model: 'gpt-5.5'}} as unknown as AgentReviewConfig;

function makeContext(models: Array<{provider: string; id: string; api?: string}>, pick: string | undefined) {
	const select = vi.fn().mockResolvedValue(pick);
	const context = {modelRegistry: {getAvailable: () => models}, ui: {select}};
	return {context, select};
}

describe('openModelPicker', () => {
	it('offers current first, then tool-capable models as provider/id specs', async () => {
		const {context, select} = makeContext([
			{provider: 'anthropic', id: 'claude-haiku-4-5', api: 'anthropic-messages'},
			{provider: 'openai-codex', id: 'gpt-5.5', api: 'openai-codex-responses'},
		], undefined);

		await openModelPicker(context, config);

		const [title, options] = select.mock.calls[0] as [string, string[]];
		expect(title).toContain('openai-codex/gpt-5.5');
		expect(options[0]).toContain('current');
		expect(options).toContain('anthropic/claude-haiku-4-5');
		expect(options).toContain('openai-codex/gpt-5.5');
	});

	it('maps the current option back to the current spec', async () => {
		const {context} = makeContext([{provider: 'openai-codex', id: 'gpt-5.5', api: 'openai-codex-responses'}], 'current (use the active session model)');
		expect(await openModelPicker(context, config)).toBe('current');
	});

	it('returns the chosen provider/model spec verbatim', async () => {
		const {context} = makeContext([{provider: 'anthropic', id: 'claude-haiku-4-5', api: 'anthropic-messages'}], 'anthropic/claude-haiku-4-5');
		expect(await openModelPicker(context, config)).toBe('anthropic/claude-haiku-4-5');
	});

	it('never shows an empty list: falls back to all available models when none advertise tool support', async () => {
		const {context, select} = makeContext([{provider: 'opencode-go', id: 'deepseek-v4-pro', api: 'some-unknown-api'}], undefined);

		await openModelPicker(context, config);

		const [, options] = select.mock.calls[0] as [string, string[]];
		expect(options).toEqual(['current (use the active session model)', 'opencode-go/deepseek-v4-pro']);
	});

	it('returns undefined when the user cancels', async () => {
		const {context} = makeContext([{provider: 'openai-codex', id: 'gpt-5.5', api: 'openai-codex-responses'}], undefined);
		expect(await openModelPicker(context, config)).toBeUndefined();
	});
});
