# Architecture

## Flow

```
tool_call  → tool-call-handler → gate → exact-approval match → allow
                                      ↘ reviewer → allow / block
tool_result → tool-result-handler → output reviewer → pass / withhold + stop
```

`index.ts` wires the pi events (`session_start`, `session_tree`, `turn_start`,
`tool_call`, `tool_result`), the `/agent-review` command, the
`request_user_approval` tool, and the review-log renderer.

## Modules

Top level (`src/`):

- `index.ts` — event and command wiring.
- `tool-call-handler.ts` — request-review pipeline: gate → approval lookup →
  reviewer → notify/block, with the denial circuit breaker.
- `tool-result-handler.ts` — output-review pipeline: withhold and stop on a leak.
- `command.ts` — `/agent-review` subcommands.
- `config.ts` — load, merge, validate, and persist config.
- `config-menu.ts`, `model-picker.ts` — interactive TUI menus.
- `runtime-state.ts` — in-memory per-session state (session on/off toggle,
  tracker, cost, last reviews). The toggle is deliberately never persisted to or
  re-synced from the session branch: branch entries don't survive retries or
  forks, which silently re-enabled review.
- `denial-tracker.ts` — consecutive/rolling denial circuit breaker.
- `review-log.ts` — append-only review log entries and their renderer.

`src/approval/`:

- `approval-gate.ts` — deterministic secret-path hard-deny.
- `approval-ledger.ts` — one-shot, nonce-keyed, expiring user approvals.
- `approval-tool.ts` — the `request_user_approval` tool.

`src/review/`:

- `model-call.ts` — shared reviewer-model call (auth, timeout, tool parsing).
- `reviewer.ts` — request-review prompt and decision.
- `output-reviewer.ts` — output-review prompt and decision.
- `run-review.ts` — builds trusted intent + transcript, formats outcomes.
- `review-decision.ts` — decision validation and JSON fallback parsing.
- `normalize-tool-call.ts` — serialize/fence tool-call arguments.
- `approval-context.ts` — extract trusted user intent from the branch.
- `transcript.ts` — compact the branch into reviewer context.
- `tool-support.ts` — per-provider tool-choice capability.

`src/shared/` — `guards.ts` (type guards, error coercion), `content.ts`
(text-part joining), `branch-messages.ts` (message unwrapping).

## Trust model

The reviewer treats the transcript and tool-call arguments as untrusted; only
direct user messages, `ask_user_question` answers, and an explicit
`approved_by_user` grant carry authority. Secret-path denials and hard-safety
denials hold regardless of approval.

Approval grants bind to the exact serialized input and cwd the user saw. An
exact match is approved mechanically; anything else is judged by the reviewer,
which must report `matchedApproval` — the grant is consumed only on a reported
match. Consumed nonces are kept in a process-lifetime kill list so a session
fork that predates the consumption entry cannot resurrect a spent grant.
