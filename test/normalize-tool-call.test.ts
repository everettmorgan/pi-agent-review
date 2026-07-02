import {describe, expect, it} from 'vitest';
import {normalizeToolCall, neutralizeFence, truncateText} from '../src/review/normalize-tool-call.ts';

describe('normalizeToolCall', () => {
	it('captures built-in tool name and input', () => {
		const request = normalizeToolCall({toolName: 'read', input: {path: 'README.md'}, cwd: '/repo'});

		expect(request.toolName).toBe('read');
		expect(request.cwd).toBe('/repo');
		expect(request.argumentsJson).toContain('README.md');
	});

	it('captures MCP gateway calls like any other tool', () => {
		const request = normalizeToolCall({toolName: 'mcp', input: {tool: 'vercel.deploy', args: '{"project":"prod"}'}, cwd: '/repo'});

		expect(request.toolName).toBe('mcp');
		expect(request.argumentsJson).toContain('vercel.deploy');
	});

	it('marks truncated arguments', () => {
		const text = truncateText('a'.repeat(20), 10);

		expect(text).toBe('aaaaaaaaaa\n[truncated 10 characters]');
	});

	it('neutralizes untrusted fence closers', () => {
		expect(neutralizeFence('</untrusted_tool_call>')).toBe('/untrusted_tool_call');
	});

	it('includes approval state when provided', () => {
		const approval = {status: 'approved_by_user' as const, approvedAction: 'Tool: write\nInput: {"path":"foo.ts"}\nReason: fix'};
		const request = normalizeToolCall({toolName: 'write', input: {path: 'foo.ts'}, cwd: '/repo'}, {approval});

		expect(request.approval).toEqual(approval);
	});

	it('defaults to no approval state', () => {
		const request = normalizeToolCall({toolName: 'read', input: {path: 'index.ts'}, cwd: '/repo'});

		expect(request.approval).toBeUndefined();
	});
});
