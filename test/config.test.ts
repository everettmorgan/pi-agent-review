import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	defaultConfig,
	loadConfigFromPath,
	setReviewerModel,
} from '../src/config.ts';

describe('loadConfigFromPath', () => {
	it('returns defaults when the config file is missing', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const result = await loadConfigFromPath(path.join(directory, 'missing.json'));

		expect(result).toEqual({ok: true, value: defaultConfig});
	});

	it('loads valid config overrides', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');
		await writeFile(filePath, JSON.stringify({review: {timeoutMs: 1000}}));

		const result = await loadConfigFromPath(filePath);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.review.timeoutMs).toBe(1000);
		}
	});

	it('tolerates legacy enabled state in config', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');
		await writeFile(filePath, JSON.stringify({review: {isReviewEnabled: false}}));

		const result = await loadConfigFromPath(filePath);

		expect(result.ok).toBe(true);
	});

	it('fails closed for invalid config', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');
		await writeFile(filePath, JSON.stringify({review: {timeoutMs: -1}}));

		const result = await loadConfigFromPath(filePath);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('timeoutMs');
		}
	});

	it('persists reviewer model as current', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');

		const result = await setReviewerModel(filePath, 'current');
		const file = JSON.parse(await readFile(filePath, 'utf8')) as {reviewer: {provider: string; model: string}};

		expect(result.ok).toBe(true);
		expect(file.reviewer.provider).toBe('current');
		expect(file.reviewer.model).toBe('current');
	});

	it('persists reviewer model as provider/model', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');

		const result = await setReviewerModel(filePath, 'anthropic/claude-haiku-4-5');
		const file = JSON.parse(await readFile(filePath, 'utf8')) as {reviewer: {provider: string; model: string}};

		expect(result.ok).toBe(true);
		expect(file.reviewer.provider).toBe('anthropic');
		expect(file.reviewer.model).toBe('claude-haiku-4-5');
	});

	it('fails for invalid model spec', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');

		const result = await setReviewerModel(filePath, 'bogus');

		expect(result.ok).toBe(false);
	});

	it('does not persist legacy enabled state when setting reviewer model', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
		const filePath = path.join(directory, 'config.json');

		await writeFile(filePath, JSON.stringify({review: {isReviewEnabled: false}}));
		await setReviewerModel(filePath, 'anthropic/claude-haiku-4-5');

		const file = JSON.parse(await readFile(filePath, 'utf8')) as {review: Record<string, unknown>};
		expect(file.review.isReviewEnabled).toBeUndefined();
	});
});
