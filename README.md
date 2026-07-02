# Agent Review for pi

Global pi extension that reviews every tool call before execution.

## Install

Place this directory at:

```text
~/.pi/agent/extensions/agent-review
```

Run `/reload` in pi.

## Dev

```bash
npm test       # run tests
npm run lint   # run xo
npm run lint:fix
npm run typecheck
```

## Commands

- `/agent-review status`
- `/agent-review on`
- `/agent-review off`
- `/agent-review model` -- opens a fuzzy-search model picker with all configured providers
- `/agent-review model current`
- `/agent-review model <provider>/<model>`
- `/agent-review test <tool-name> <json-args>`

## Behavior

Agent Review is enabled by default in every session. When enabled, every `tool_call` is sent to a direct reviewer model call using `complete` from `@earendil-works/pi-ai/compat`. Approved calls run unchanged. Denied calls are blocked with no-workaround guidance. Reviewer failures block by default.

Agent Review uses a deterministic approval gate for risky actions. Read-only tools (read, ls, grep, find) run without approval. Writes, edits, bash, MCP calls, and unknown tools require explicit user confirmation via a dialog showing the exact action. Approvals are recorded as session entries and consumed on exact-action match. The reviewer handles residual safety only and can still deny hard-safety violations (secrets, exfiltration, destructive actions) even when the user approved. Direct user messages and structured `ask_user_question` answers are passed as trusted context but are not the authorization mechanism.

`/agent-review off` disables review for the current session only and records that choice in the session branch. `/agent-review on` re-enables review for the current session. New sessions default back to enabled unless they contain their own Agent Review session state.

Use `/agent-review model <provider>/<model>` to choose a dedicated reviewer model globally. Use `/agent-review model current` to use the active session model.

## Config

Optional config path:

```text
~/.pi/agent/agent-review/config.json
```

Default config:

```json
{
  "review": {
    "timeoutMs": 30000,
    "denyOnReviewerFailure": true,
    "consecutiveDenialLimit": 3,
    "rollingDenialLimit": 10
  },
  "reviewer": {
    "type": "direct-model",
    "provider": "current",
    "model": "current"
  }
}
```

Older config files with `review.isReviewEnabled` are tolerated for compatibility, but enabled/disabled state is now session-scoped and is no longer written to global config.
