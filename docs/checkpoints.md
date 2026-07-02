# Agent Review Checkpoints

## Task 1: Project scaffold and config module

Files changed:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `config.ts`
- `test/config.test.ts`

Verification:

```text
npm test -- test/config.test.ts: 1 passed, 3 tests passed
npm run typecheck: exit 0
```

## Task 2: Decision parser and denial tracker

Files changed:

- `reviewDecision.ts`
- `denialTracker.ts`
- `test/reviewDecision.test.ts`
- `test/denialTracker.test.ts`

Verification:

```text
npm test -- test/reviewDecision.test.ts test/denialTracker.test.ts: 2 passed, 7 tests passed
npm run typecheck: exit 0
```

## Task 3: Tool-call normalization and transcript compaction

Files changed:

- `normalizeToolCall.ts`
- `transcript.ts`
- `test/normalizeToolCall.test.ts`
- `test/transcript.test.ts`

Verification:

```text
npm test -- test/normalizeToolCall.test.ts test/transcript.test.ts: 2 passed, 6 tests passed
npm run typecheck: exit 0
```

## Task 4: Direct model reviewer

Files changed:

- `reviewer.ts`
- `test/reviewer.test.ts`

Verification:

```text
npm test -- test/reviewer.test.ts: 1 passed, 2 tests passed
npm run typecheck: exit 0
```

## Task 5: Extension entrypoint and commands

Files changed:

- `index.ts`

Verification:

```text
npm test: 6 passed, 18 tests passed
npm run typecheck: exit 0
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0, model list printed
```

Interactive checks still need to be run in a pi TUI session:

```text
/reload
/agent-review status
/agent-review test read {"path":"README.md"}
```

## Task 6: Documentation and final verification

Files changed:

- `README.md`

Verification:

```text
npm test: 6 passed, 18 tests passed
npm run typecheck: exit 0
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts -p "/agent-review status": exit 0
```

Manual TUI checks still need an interactive pi session because extension notifications are not printed in the non-interactive shell:

```text
/reload
/agent-review status
/agent-review test read {"path":"README.md"}
Read README.md and summarize it in one sentence.
```

## Final real-turn smoke test

Verification:

```text
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts -p "Read README.md and summarize it in one sentence."
```

Output:

```text
Agent Review is a pi extension that reviews and approves or blocks every tool call before execution, with configurable reviewer behavior and commands for status/testing.
```

## Toggle patch: persistent on/off commands

Files changed:

- `config.ts`
- `index.ts`
- `README.md`
- `test/config.test.ts`

Verification:

```text
npm test: 6 passed, 20 tests passed
npm run typecheck: exit 0
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0, model list printed
```

Real model smoke command was attempted but blocked by provider quota:

```text
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts -p "Read README.md and summarize it in one sentence."
Codex error: The usage limit has been reached
```

## Reviewer model selection patch

Files changed:

- `config.ts`
- `reviewer.ts`
- `index.ts`
- `README.md`
- `test/config.test.ts`

Verification:

```text
npm test: 6 passed, 24 tests passed
npm run typecheck: exit 0
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0, model list printed
```

## Model menu picker

Files changed:

- `index.ts`
- `README.md`

Replaced the plain `/agent-review model` text display with a `ctx.ui.select(...)` TUI menu that lists all available models from configured providers plus a "Current session model" option.

Verification:

```text
npm test: 6 passed, 24 tests passed
npm run typecheck: exit 0
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Fuzzy-search model picker

Files changed:

- `index.ts`
- `package.json`
- `package-lock.json`
- `README.md`

Replaced the plain `ctx.ui.select(...)` picker with a `SelectList` component from pi-tui that provides the same fuzzy-search model selector UX as pi's built-in `/model` command. Falls back to a plain notification when not in TUI mode.

Verification:

```text
npm test: 6 passed, 24 tests passed
npm run typecheck: exit 0
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Rewrite model picker to mimic pi's built-in /model selector

Files changed:

- `index.ts`

Replaced the manual query-tracking + SelectList approach with a direct port of pi's `ModelSelectorComponent` pattern:
- Uses `Input` component from pi-tui for the search field (with cursor, backspace, paste, undo).
- Uses `fuzzyFilter` from pi-tui for real fuzzy matching against `provider`, `model id`, and `name`.
- Renders the list manually as Text lines in a listContainer, with selected/current markers and scroll indicator.
- Input routing matches pi: arrows/enter/escape navigate, everything else goes to the search input then re-filters.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 24 tests passed
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Robust reviewer JSON parsing

Files changed:

- `reviewDecision.ts`
- `test/reviewDecision.test.ts`

Bug: reviewer models (e.g. gemini via openrouter) return JSON wrapped in markdown fences or prose. The strict parser failed closed on every call, blocking all tool calls and tripping the circuit breaker.

Fix: `parseReviewDecision` now extracts the first balanced JSON object from the response text (handling markdown code fences, leading/trailing prose, and nested objects), then validates it. Only truly JSON-less output fails closed.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
```

## Force structured reviewer output via tool calling

Files changed:

- `reviewer.ts`
- `reviewDecision.ts` (exported validateDecision)
- `test/reviewer.test.ts`

Bug: reviewer models that ignore JSON instructions returned prose with no JSON, failing closed on every call and locking out the agent.

Fix: define a `submit_review_decision` tool (typebox schema) and pass it in `Context.tools`. The model is strongly nudged to call the tool, returning structured `arguments` directly (no text parsing). If the model still returns text, the robust JSON extractor is the fallback. `validateDecision` is shared by both paths.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Filter picker to tool-supporting models; force tool choice

Files changed:

- `toolSupport.ts` (new)
- `reviewer.ts`
- `index.ts`

Changes:
- New `toolSupport.ts` defines the set of tool-supporting APIs and maps each to its forced `toolChoice` value (`required` for OpenAI-style, `any` for Anthropic/Google/Bedrock).
- Model picker now filters `getAvailable()` to models whose `api` supports tool calling, and only offers "Current session model" when the active model supports tools.
- Reviewer now passes `toolChoice` (forced) so the model must call `submit_review_decision`. Dropped the retry loop; a single text-extractor fallback remains for models that return JSON in text despite the forced choice.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Surface reviewer response errors instead of "(empty)"

Files changed:

- `reviewer.ts`

Bug: when `complete()` returned an error response (rate limit, context-length, abort), `response.content` was `[]` with `stopReason: "error"` and `errorMessage` set, but `runReviewer` ignored both and reported "(empty)", hiding the real cause.

Fix: check `stopReason` for `error`/`aborted` first and return `errorMessage`. For other non-tool-call cases, include `stopReason` and content part types in the failure reason so failures are diagnosable.

Diagnostic confirmed tool calling works with openrouter/openai/gpt-5.4-mini (returns proper approve toolCall); the empty responses were API errors being swallowed.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
```

## Always notify reviewer outcome

Files changed:

- `index.ts`

Every tool call review now emits a `ctx.ui.notify` with the decision and rationale:
- approve -> info notification: "Agent Review approved <tool>: <rationale>"
- deny -> warning notification: "Agent Review denied <tool>: <rationale>"
- failure -> error notification: "Agent Review blocked <tool>: <error>"

Previously approvals were silent (only tracked in lastStatus). Now every outcome is visible in the session.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
pi --no-extensions -e ~/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```

## Codex-style risk-tiered reviewer policy

Files changed:

- `reviewer.ts`

Researched OpenAI Codex auto-review (developers.openai.com/codex/concepts/sandboxing/auto-review) and the open-source guardian policy (github.com/openai/codex policy.md). Rewrote the reviewer SYSTEM_PROMPT as a risk-tiered policy:

1. Reads and context gathering (source, docs, skills, tool defs, extensions under ~/.pi/agent, grep/find/ls, read-only MCP): APPROVE.
2. Execution and writing (bash, edit, write, installs, mutations): DENY BY DEFAULT unless clearly justified, scoped, bounded, non-destructive.
3. Secrets (.env, ~/.ssh, ~/.npmrc, credentials, tokens): ALWAYS DENY.
4. Persistent security weakening: DENY.
5. Destructive actions: DENY.
6. Data exfiltration: DENY.
7. Supply-chain / external service mutations: DENY unless explicitly requested.

Also raised maxTokens 1024 -> 4096 for reasoning-model headroom, and exported SYSTEM_PROMPT.

Live diagnostic against openrouter/openai/gpt-5.4-mini confirmed:
- read skill file -> approve
- read extension -> approve
- read source -> approve
- read .env -> deny
- read ssh key -> deny
- fork bomb -> deny
- edit source -> deny

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
```

## Remove notification duplication

Files changed:

- `index.ts`

Removed the redundant `ctx.ui.notify` for denials and failures — the block reason already shows the full rationale + no-workaround guidance, so the notification was duplicating it. Approvals keep a concise notify ("Agent Review approved {tool}") since there is no block reason to signal them. Approval notify no longer includes the full rationale to reduce noise.

Verification:

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
```

## Show review decision cost

Files changed:

- `reviewer.ts`
- `index.ts`

`runReviewer` now captures `response.usage.cost.total` and returns it as `cost` on every result. The decision log lines append the formatted cost:
- approve notify: `Agent Review approved {tool}: {rationale} ($0.0005)`
- deny block reason: `... {no-workaround guidance} Review cost: $0.0005.`
- failure block reason: `... Review cost: $0.0000.` (0 on API error)
- `lastStatus` and `/agent-review status` also carry the last cost.

`formatCost` shows 4 decimals under $0.01, else 2 decimals. Early returns before a model call (no model / no auth) use cost 0.

Verified: earlier live diag with gpt-5.4-mini returned usage.cost.total 0.00046875; this run hit a rate-limit error and correctly reported total 0.

```text
npm run typecheck: exit 0
npm test: 6 passed, 25 tests passed
```

## Per-session enabled state and typecheck cleanup

Files changed:

- `config.ts`
- `index.ts`
- `model-picker.ts`
- `normalize-tool-call.ts`
- `review-decision.ts`
- `reviewer.ts`
- `session-state.ts` (new)
- `transcript.ts`
- `README.md`
- `test/config.test.ts`
- `test/reviewer.test.ts`
- `test/session-state.test.ts` (new)
- `test/transcript.test.ts`
- `docs/superpowers/plans/2026-06-28-agent-review-session-state.md` (new)

Changes:

- `/agent-review on` and `/agent-review off` now store enabled state in session custom entries (`agent-review-state`) instead of global config.
- Review state defaults to enabled when no session state exists, and is restored on `session_start` and `session_tree`.
- Global config still tolerates old `review.isReviewEnabled`, but config writes omit it.
- Transcript compaction now handles real pi session message entry shape (`{ type: "message", message: ... }`).
- Reviewer calls now enforce `review.timeoutMs` with an aborting timeout signal.
- Fixed TypeScript strictness failures in config, index, model picker, normalizer, decision parsing, reviewer typing, and transcript helpers.

Verification:

```text
npm test: 7 passed, 31 tests passed
npm run typecheck: exit 0
npm run lint: exit 0 (16 warnings reported by XO; no lint errors)
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0
```
## Approval context propagation

Files changed:

- `approval-context.ts` (new)
- `index.ts`
- `reviewer.ts`
- `README.md`
- `test/approval-context.test.ts` (new)
- `test/reviewer.test.ts`
- `docs/superpowers/plans/2026-06-28-agent-review-approval-context.md` (new)

Changes:

- Direct user messages and `ask_user_question` tool results are extracted as trusted user intent.
- Reviewer prompts now include a dedicated trusted-intent section before generic transcript context.
- The reviewer policy now states that `ask_user_question` answers are first-party user intent, while arbitrary tool results remain untrusted.
- Tool-call review and `/agent-review test` both pass trusted-intent context into the reviewer.

Verification:

```text
npm test: 8 test files passed, 40 tests passed
npm run typecheck: exit 0
npm run lint: exit 0 (17 warnings reported by XO; no lint errors)
pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0, 305-line non-empty output
```

## Deterministic approval ledger

Files changed:

- `approval-gate.ts` (new)
- `approval-ledger.ts` (new)
- `index.ts`
- `normalize-tool-call.ts`
- `reviewer.ts`
- `README.md`
- `test/approval-gate.test.ts` (new)
- `test/approval-ledger.test.ts` (new)
- `test/normalize-tool-call.test.ts`
- `test/reviewer.test.ts`
- `docs/superpowers/plans/2026-06-28-agent-review-approval-ledger.md` (new)

Changes:

- Added deterministic `classifyToolCall` gate: read-only tools allow, writes/edits/bash/mcp require approval, secrets deny.
- Added `ApprovalLedger` with exact-action SHA256 hashing, one-shot consumption, and branch restore.
- Extended `ReviewRequest` with optional `ApprovalState` and `argsHash`.
- Updated reviewer prompt with deterministic approval rules alongside existing risk policy.
- Integrated gate, ledger, and approval state into `tool_call` handler and `/agent-review test`.
- README now documents deterministic approval workflow.

Verification:

    npm test: 10 test files passed, 66 tests passed
    npm run typecheck: exit 0
    npm run lint: exit 0 (17 warnings reported by XO; no lint errors)
    pi --no-extensions -e /Users/everettmorgan/.pi/agent/extensions/agent-review/index.ts --list-models: exit 0, non-empty output
