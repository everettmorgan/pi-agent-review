# Contributing

## Setup

```bash
npm install
```

## Checks

All three must pass; CI runs them on every pull request.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # xo (auto-fix with npm run lint:fix)
npm test            # vitest
```

## Pull requests

- Branch from `main`; keep each PR focused on one change.
- Add or update tests for behavior changes. Pure logic lives in small,
  testable modules — see [docs/architecture.md](docs/architecture.md).
- Keep functions small: the lint config caps complexity, statement count, and
  parameters. Prefer decomposition over disabling a rule.
- Security-sensitive changes (the gate, ledger, reviewer prompts) need a test
  covering the new behavior.
- Update the README when you change commands, config, or behavior.

## Releases

Tag `vX.Y.Z` on `main` and push the tag; publish a GitHub release. Users install
a tag with `pi install git:github.com/everettmorgan/pi-agent-review@vX.Y.Z`.
