import {describe, expect, it} from 'vitest';
import {classifyToolCall} from '../src/approval/approval-gate.ts';

describe('classifyToolCall', () => {
	it('allows read-only tools', () => {
		expect(classifyToolCall({toolName: 'read', input: {path: 'index.ts'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'ls', input: {path: '.'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'grep', input: {pattern: 'foo', path: '.'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'find', input: {pattern: '*.ts'}, cwd: '/repo'})).toEqual({action: 'allow'});
	});

	it('allows mutating tools so the reviewer decides', () => {
		expect(classifyToolCall({toolName: 'write', input: {path: 'foo.ts', content: 'x'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'edit', input: {path: 'foo.ts', edits: [{oldText: 'a', newText: 'b'}]}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'bash', input: {command: 'npm test'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'mcp', input: {tool: 'vercel.deploy', args: '{}'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'my_custom_tool', input: {action: 'run'}, cwd: '/repo'})).toEqual({action: 'allow'});
	});

	it('denies secret-targeting paths', () => {
		const result = classifyToolCall({toolName: 'read', input: {path: '.env'}, cwd: '/repo'});
		expect(result.action).toBe('deny');
		if (result.action === 'deny') {
			expect(result.reason).toContain('secret');
		}
	});

	it('denies secret-targeting paths for any tool, not just reads', () => {
		const result = classifyToolCall({toolName: 'write', input: {path: '.env', content: 'x'}, cwd: '/repo'});
		expect(result.action).toBe('deny');
	});

	it('denies .ssh paths', () => {
		const result = classifyToolCall({toolName: 'read', input: {path: '~/.ssh/id_rsa'}, cwd: '/repo'});
		expect(result.action).toBe('deny');
	});

	it('denies credential stores', () => {
		const result = classifyToolCall({toolName: 'read', input: {path: '~/.aws/credentials'}, cwd: '/repo'});
		expect(result.action).toBe('deny');
	});
});
