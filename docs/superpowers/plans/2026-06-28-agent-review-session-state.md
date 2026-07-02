# Agent Review Per-Session State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Review enabled/disabled state session-scoped and default-on while fixing current typecheck/lint failures.

**Architecture:** Keep global JSON config for reviewer settings, timeouts, and denial limits only. Store the enabled flag in session custom entries using `pi.appendEntry("agent-review-state", { isReviewEnabled })`, restore the latest entry from the active branch on `session_start` and `session_tree`, and use in-memory state during `tool_call`. Add focused tests first for session state, real session transcript entries, model-picker edge cases, and reviewer timeout behavior.

**Tech Stack:** TypeScript pi extension, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`, Vitest, XO.

---

## File structure

- Modify `config.ts`: remove persisted enabled-state writer, tolerate old `review.isReviewEnabled`, fix strict null typing.
- Create `session-state.ts`: pure helpers for default-on session state restoration and snapshot creation.
- Modify `index.ts`: use session-state helpers for `/agent-review on|off`, `tool_call`, `status`, and session lifecycle restoration.
- Modify `transcript.ts`: support real `SessionMessageEntry` shape as well as direct test message shape.
- Modify `model-picker.ts`: use synchronous `getAvailable()`, injected keybindings, undefined cancel handling, and no-op empty selection.
- Modify `reviewer.ts`: type selected model, use `StringEnum`, and enforce `review.timeoutMs` with an aborting timeout signal.
- Modify `normalize-tool-call.ts`, `review-decision.ts`: fix ES2022 regex/null type issues.
- Modify tests in `test/*.test.ts` and add `test/session-state.test.ts`.
- Modify `README.md`: document session-scoped on/off state.

### Task 1: Write failing tests for session state and known regressions

**Files:**
- Create: `test/session-state.test.ts`
- Modify: `test/transcript.test.ts`
- Modify: `test/config.test.ts`
- Modify: `test/reviewer.test.ts`

- [ ] **Step 1: Add session state tests**

Create `test/session-state.test.ts` with tests for default-on state, latest branch custom entry restore, and snapshot shape:

```ts
import {describe, expect, it} from 'vitest';
import {defaultSessionReviewState, getReviewStateFromBranch, makeReviewStateEntryData} from '../session-state.ts';

describe('session review state', () => {
	it('defaults review to enabled without session state', () => {
		expect(getReviewStateFromBranch([])).toEqual(defaultSessionReviewState);
	});

	it('restores latest agent-review-state entry from branch', () => {
		const branch = [
			{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: false}},
			{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: true}},
		];

		expect(getReviewStateFromBranch(branch)).toEqual({isReviewEnabled: true});
	});

	it('ignores malformed state entries', () => {
		const branch = [{type: 'custom', customType: 'agent-review-state', data: {isReviewEnabled: 'no'}}];

		expect(getReviewStateFromBranch(branch)).toEqual(defaultSessionReviewState);
	});

	it('creates serializable state entry data', () => {
		expect(makeReviewStateEntryData(false)).toEqual({isReviewEnabled: false});
	});
});
```

- [ ] **Step 2: Add real transcript entry test**

Append to `test/transcript.test.ts`:

```ts
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
```

- [ ] **Step 3: Adjust config tests for global enabled-state removal**

Replace the old persistent enabled-state test with one that verifies legacy config is tolerated but not central to session state:

```ts
it('tolerates legacy enabled state in config', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'agent-review-config-'));
	const filePath = path.join(directory, 'config.json');
	await writeFile(filePath, JSON.stringify({review: {isReviewEnabled: false}}));

	const result = await loadConfigFromPath(filePath);

	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.value.review.isReviewEnabled).toBe(false);
	}
});
```

- [ ] **Step 4: Add reviewer timeout helper test**

Add a testable timeout helper in `reviewer.ts` later; first add this to `test/reviewer.test.ts`:

```ts
import {createTimeoutSignal} from '../reviewer.ts';

it('creates an aborting timeout signal', async () => {
	const {signal, cleanup} = createTimeoutSignal(undefined, 1);
	await new Promise(resolve => setTimeout(resolve, 5));
	expect(signal.aborted).toBe(true);
	cleanup();
});
```

- [ ] **Step 5: Run focused tests and verify they fail**

Run:

```bash
cd /Users/everettmorgan/.pi/agent/extensions/agent-review && npm test -- test/session-state.test.ts test/transcript.test.ts test/reviewer.test.ts
```

Expected: FAIL because `session-state.ts` and `createTimeoutSignal` do not exist and transcript does not support real session entries.

### Task 2: Implement session state and transcript fixes

**Files:**
- Create: `session-state.ts`
- Modify: `transcript.ts`
- Modify: `index.ts`
- Modify: `config.ts`

- [ ] **Step 1: Implement pure session-state helper**

Create `session-state.ts`:

```ts
export const agentReviewStateEntryType = 'agent-review-state';

export type SessionReviewState = {
	isReviewEnabled: boolean;
};

export const defaultSessionReviewState: SessionReviewState = {
	isReviewEnabled: true,
};

type CustomEntryLike = {
	type?: unknown;
	customType?: unknown;
	data?: unknown;
};

function isStateData(value: unknown): value is SessionReviewState {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& typeof (value as {isReviewEnabled?: unknown}).isReviewEnabled === 'boolean';
}

export function getReviewStateFromBranch(branch: unknown[]): SessionReviewState {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as CustomEntryLike;
		if (entry.type === 'custom' && entry.customType === agentReviewStateEntryType && isStateData(entry.data)) {
			return {isReviewEnabled: entry.data.isReviewEnabled};
		}
	}

	return defaultSessionReviewState;
}

export function makeReviewStateEntryData(isReviewEnabled: boolean): SessionReviewState {
	return {isReviewEnabled};
}
```

- [ ] **Step 2: Fix transcript entry normalization**

Update `transcript.ts` so `formatEntry` receives either direct messages or `{type:'message', message}` entries:

```ts
type MessageLike = {
	role?: string;
	content?: string | ContentPart[];
};

type BranchEntry = MessageLike | {
	type?: string;
	message?: MessageLike;
};

function unwrapMessage(entry: BranchEntry): MessageLike {
	if ('message' in entry && entry.type === 'message' && entry.message !== undefined) {
		return entry.message;
	}

	return entry as MessageLike;
}

function formatEntry(entry: BranchEntry): string | null {
	const message = unwrapMessage(entry);
	if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
		return null;
	}

	const text = extractText(message.content);
	if (text.trim() === '') {
		return null;
	}

	return `${message.role}: ${text}`;
}
```

- [ ] **Step 3: Change index.ts to session-scoped state**

In `index.ts`:

- import `getReviewStateFromBranch`, `makeReviewStateEntryData`, and `agentReviewStateEntryType`.
- replace `lastDecision: LastDecision | undefined = null` with `LastDecision | null`.
- add `let sessionReviewState = defaultSessionReviewState;`.
- restore state on `session_start` and `session_tree` using `context.sessionManager.getBranch()`.
- change `/agent-review on|off` to:

```ts
sessionReviewState = makeReviewStateEntryData(isEnabled);
pi.appendEntry(agentReviewStateEntryType, sessionReviewState);
context.ui.notify(`Agent Review ${isEnabled ? 'enabled' : 'disabled'} for this session.`, 'info');
return;
```

- change `tool_call` enabled check to `if (!sessionReviewState.isReviewEnabled) return;`.
- change status to report session state.
- change model picker cancel check to `if (choice === undefined) return;`.

- [ ] **Step 4: Stop using global config writer for enabled state**

In `config.ts`, remove `setReviewEnabled` export and any `writeFile` import usage that only supported it. Keep `isReviewEnabled` in the type and merge for backward compatibility.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/everettmorgan/.pi/agent/extensions/agent-review && npm test -- test/session-state.test.ts test/transcript.test.ts test/config.test.ts
```

Expected: PASS for focused session/config/transcript tests.

### Task 3: Fix typecheck failures and reviewer timeout/model picker quality issues

**Files:**
- Modify: `config.ts`
- Modify: `review-decision.ts`
- Modify: `normalize-tool-call.ts`
- Modify: `reviewer.ts`
- Modify: `model-picker.ts`
- Modify: `test/reviewer.test.ts`

- [ ] **Step 1: Fix null return types**

Use `string | null` where functions return `null`, or return `undefined` consistently. Required changes:

- `config.ts`: `validatePositiveInteger(...): string | null`, `validateConfig(...): string | null`.
- `review-decision.ts`: `extractJsonObject(...): string | null`.
- `transcript.ts`: `formatEntry(...): string | null`.

- [ ] **Step 2: Fix ES2022 regex flags**

Change `normalize-tool-call.ts` to:

```ts
export function neutralizeFence(text: string): string {
	return text.replace(/<\/?untrusted_tool_call>/gi, match => match.replace(/[<>]/g, ''));
}
```

- [ ] **Step 3: Type reviewer model and use StringEnum**

In `reviewer.ts`, import `type Api, type Model, StringEnum` from `@earendil-works/pi-ai`, type `ReviewerContext.model` and `modelRegistry.find`, use `StringEnum(['approve', 'deny'] as const)` for tool schema, and pass a real `Model<Api>` to `complete`.

- [ ] **Step 4: Implement timeout signal helper**

Add to `reviewer.ts`:

```ts
export function createTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): {signal: AbortSignal; cleanup: () => void} {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const abortFromParent = () => controller.abort();
	parentSignal?.addEventListener('abort', abortFromParent, {once: true});
	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timeout);
			parentSignal?.removeEventListener('abort', abortFromParent);
		},
	};
}
```

Wrap the `complete` call in `try/finally` and use `createTimeoutSignal(context.signal, config.review.timeoutMs)`.

- [ ] **Step 5: Fix model picker context typing and empty selection**

In `model-picker.ts`:

- `getAvailable()` is synchronous: `getAvailable(): Array<...>`.
- remove `getKeybindings` import and use injected `keybindings` with a local type that has `matches(data, id)`.
- before selecting on Enter, check `const selected = filteredItems[selectedIndex]; if (selected === undefined) return;`.

- [ ] **Step 6: Widen reviewer test response part type**

In `test/reviewer.test.ts`, type the response object as the function parameter type or cast non-text parts to `{type: string}` so the object literal with `name` does not fail excess property checks.

- [ ] **Step 7: Run typecheck and focused tests**

Run:

```bash
cd /Users/everettmorgan/.pi/agent/extensions/agent-review && npm test -- test/reviewer.test.ts test/normalize-tool-call.test.ts test/review-decision.test.ts && npm run typecheck
```

Expected: PASS.

### Task 4: Documentation, lint, and full verification

**Files:**
- Modify: `README.md`
- Modify: tests/source as required by lint

- [ ] **Step 1: Update README commands/config behavior**

Update README Behavior/Commands to say `/agent-review on` and `/agent-review off` apply to the current session only, default is enabled for new sessions, and global config no longer controls enabled state.

- [ ] **Step 2: Run full verification**

Run:

```bash
cd /Users/everettmorgan/.pi/agent/extensions/agent-review && npm test && npm run typecheck && npm run lint
```

Expected: all pass.

- [ ] **Step 3: Run extension load smoke check**

Run:

```bash
cd /Users/everettmorgan/.pi/agent/extensions/agent-review && pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models >/tmp/agent-review-models.txt
```

Expected: exit 0.

- [ ] **Step 4: Record checkpoint**

Append a checkpoint to `docs/checkpoints.md` with files changed and verification output because this directory is not a git repository.
