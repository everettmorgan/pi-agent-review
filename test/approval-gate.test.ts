import {describe, expect, it} from 'vitest';
import {classifyToolCall} from '../approval-gate.ts';

describe('classifyToolCall', () => {
	it('allows read-only tools without approval', () => {
		expect(classifyToolCall({toolName: 'read', input: {path: 'index.ts'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'ls', input: {path: '.'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'grep', input: {pattern: 'foo', path: '.'}, cwd: '/repo'})).toEqual({action: 'allow'});
		expect(classifyToolCall({toolName: 'find', input: {pattern: '*.ts'}, cwd: '/repo'})).toEqual({action: 'allow'});
	});

	it('allows non-UI commands without approval', () => {
		expect(classifyToolCall({toolName: 'agent-review', input: {command: 'status'}, cwd: '/repo'})).toEqual({action: 'allow'});
	});

	it('requires approval for file writes', () => {
		const result = classifyToolCall({toolName: 'write', input: {path: 'foo.ts', content: 'x'}, cwd: '/repo'});
		expect(result.action).toBe('require_approval');
		if (result.action === 'require_approval') {
			expect(result.reason).toContain('write');
		}
	});

	it('requires approval for file edits', () => {
		const result = classifyToolCall({toolName: 'edit', input: {path: 'foo.ts', edits: [{oldText: 'a', newText: 'b'}]}, cwd: '/repo'});
		expect(result.action).toBe('require_approval');
	});

	it('requires approval for bash commands', () => {
		const result = classifyToolCall({toolName: 'bash', input: {command: 'npm test'}, cwd: '/repo'});
		expect(result.action).toBe('require_approval');
	});

	it('requires approval for MCP tool calls', () => {
		const result = classifyToolCall({toolName: 'mcp', input: {tool: 'vercel.deploy', args: '{}'}, cwd: '/repo'});
		expect(result.action).toBe('require_approval');
	});

	it('requires approval for custom extension tools by default', () => {
		const result = classifyToolCall({toolName: 'my_custom_tool', input: {action: 'run'}, cwd: '/repo'});
		expect(result.action).toBe('require_approval');
	});

	it('denies secret-targeting paths', () => {
		const result = classifyToolCall({toolName: 'read', input: {path: '.env'}, cwd: '/repo'});
		expect(result.action).toBe('deny');
		if (result.action === 'deny') {
			expect(result.reason).toContain('secret');
		}
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
