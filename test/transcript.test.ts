import {describe, expect, it} from 'vitest';
import {compactTranscript} from '../transcript.ts';

type FakeSessionManager = {
	getBranch(): unknown[];
};

describe('compactTranscript', () => {
	it('includes visible user and assistant text', () => {
		const sessionManager: FakeSessionManager = {
			getBranch: () => [
				{role: 'user', content: [{type: 'text', text: 'Build this.'}]},
				{role: 'assistant', content: [{type: 'text', text: 'I will inspect files.'}]},
			],
		};

		const transcript = compactTranscript(sessionManager, {maxEntries: 10, maxChars: 1000});

		expect(transcript).toContain('user: Build this.');
		expect(transcript).toContain('assistant: I will inspect files.');
	});

	it('bounds output length', () => {
		const sessionManager: FakeSessionManager = {
			getBranch: () => [{role: 'user', content: [{type: 'text', text: 'x'.repeat(200)}]}],
		};

		const transcript = compactTranscript(sessionManager, {maxEntries: 10, maxChars: 50});

		expect(transcript.length).toBeLessThanOrEqual(80);
		expect(transcript).toContain('[truncated');
	});

	it('includes real session message entry shape', () => {
		const sessionManager: FakeSessionManager = {
			getBranch: () => [
				{type: 'message', message: {role: 'user', content: [{type: 'text', text: 'Review the extension.'}]}},
				{type: 'message', message: {role: 'assistant', content: [{type: 'toolCall', name: 'read', arguments: {path: 'index.ts'}}]}},
				{type: 'message', message: {role: 'toolResult', content: [{type: 'text', text: 'file contents'}]}},
			],
		};

		const transcript = compactTranscript(sessionManager, {maxEntries: 10, maxChars: 1000});

		expect(transcript).toContain('user: Review the extension.');
		expect(transcript).toContain('[tool call]');
		expect(transcript).toContain('toolResult: file contents');
	});
});
