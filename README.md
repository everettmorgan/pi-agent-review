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

A deterministic gate hard-denies access to secret and credential paths (`.env`, `~/.ssh`, key files, credential stores) for any tool. Everything else goes to the reviewer, which approves routine low-risk actions and denies risky ones by default.

When the reviewer denies a call the agent believes the user wants, the agent can call the `request_user_approval` tool, which shows the exact tool name and arguments in a confirmation dialog. If the user approves, a one-shot approval is recorded as a session entry keyed by an exact args hash; when the agent retries the identical call, the reviewer sees `approved_by_user` and treats it as strong authorization. The reviewer can still deny hard-safety violations (secrets, exfiltration, destructive actions) even with user approval. Direct user messages and structured `ask_user_question` answers are passed as trusted context but are not the authorization mechanism.

Every tool result is also reviewed for sensitive data (secrets, credentials, keys, tokens) by the reviewer model. A confirmed leak is blocked (the output is withheld from the model and transcript), flagged to the user, and the turn is stopped. If the output reviewer cannot run, the unreviewed output is withheld (fail-closed).

The reviewer surfaces its assessment for both stages as append-only log entries in the chat history (not transient notifications, which overwrite one another when several tool calls run in a turn). Each request review logs approve/deny/failure with the reviewer's reasoning, and each output review logs cleared/blocked/withheld with its reasoning. These log entries are shown in the transcript but are not sent to the model. `/agent-review status` also shows the last request review and the last output review.

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

Older config files with `review.isReviewEnabled` are tolerated (the field is ignored); enabled/disabled state is session-scoped and is never written to global config.
