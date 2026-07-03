# Agent Review for pi

[![CI](https://github.com/everettmorgan/pi-agent-review/actions/workflows/ci.yml/badge.svg)](https://github.com/everettmorgan/pi-agent-review/actions/workflows/ci.yml)

A pi coding-agent extension that reviews tool calls and tool output with an LLM
reviewer, hard-denies access to secrets, and gates risky actions behind user
approval.

## Install

```bash
pi install npm:pi-agent-review
```

Or add it to `settings.json`:

```json
{
  "packages": ["npm:pi-agent-review"]
}
```

For local development, place the directory at `~/.pi/agent/extensions/agent-review`
and run `/reload` in pi.

## Commands

- `/agent-review status` — current config and the last request/output review
- `/agent-review on` / `off` — enable or disable review for this session
  (in-memory; survives retries and forks, re-arms on `/new`, resume, and
  restart, does not cover subagent processes)
- `/agent-review config` — interactive menu to toggle the review stages
- `/agent-review input on|off` — review tool calls before they run
- `/agent-review output on|off` — review tool output for leaks
- `/agent-review model` — pick a reviewer model (`current`, or `provider/model`)
- `/agent-review test <tool-name> <json-args>` — dry-run a request review

## How it works

Review runs in two stages, each independently toggleable.

**Request review** (before a tool runs). A deterministic gate hard-denies access
to secret paths (`.env`, `~/.ssh`, key files, credential stores) for any tool,
matching path and command keys at any nesting depth in the arguments.
Everything else goes to the reviewer model, which approves low-risk actions and
denies risky ones. Denied calls are blocked; reviewer or config failures block
(fail-closed).

**Output review** (after a tool runs). Tool output — including error results
and structured non-text content — is checked for secrets, credentials, keys,
and tokens. A confirmed leak withholds the output from the model and transcript
and stops the turn. If the reviewer can't run, the unreviewed output is
withheld.

**User approval.** When the reviewer denies a call the user wants, the agent
calls `request_user_approval`, which shows the authentic tool name, cwd, and
full arguments first, followed by the agent's stated reason — flattened and
length-capped so it cannot forge or bury the real fields. Requests for
hard-gated actions (secret paths) are refused without prompting — approval
cannot override the gate. An approval is recorded with a unique nonce, the
exact serialized input and cwd, and a ~10 minute expiry.

A retry that exactly matches the approved tool, input, and cwd is approved
mechanically, without a reviewer call. An inexact retry goes to the reviewer,
which is told the call differs from what the user approved and must report
whether it still matches the approved action's scope; an approve consumes the
grant unless the reviewer explicitly reports the call as unrelated, so the
one-shot invariant holds even when the reviewer omits the report. Each grant
authorizes one execution: consumed nonces stay dead across retries and session
forks for the life of the process, and never override hard-safety denials.

**Logging.** A footer status segment keeps a running tally of review outcomes
and session cost (`review ✓12 ✗2 $0.43`), and shows `review off` while the
session toggle is off. Each review also appends a full log entry to the
session file — never sent to the model — and the latest request/output
assessments are shown by `/agent-review status`.

## Config

Optional, at `~/.pi/agent/agent-review/config.json`:

```json
{
  "review": {
    "reviewInput": true,
    "reviewOutput": true,
    "timeoutMs": 30000,
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

`provider`/`model` of `current` use the active session model. Enable/disable
state is session-scoped and never written to this file.

## Development

```bash
npm test        # vitest
npm run typecheck
npm run lint    # xo
```

See [docs/architecture.md](docs/architecture.md) for the module layout and
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.
