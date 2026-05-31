# CONTEXT-MAP

## Read first

- `CONTEXT.md` — domain/product overview, glossary, constraints, and open questions.
- `README.md` — public user-facing overview, usage, configuration reference, and attribution requirements.
- `docs/README.md` — documentation index; read when updating docs structure or deciding where documentation belongs.

## Architecture decisions

- `docs/adr/` — accepted, proposed, superseded, deprecated, and rejected tradeoff decisions. Create ADRs here when recording durable architecture choices.

## Context notes

- `docs/context/` — longer durable notes that should not live in chat only.
- `docs/architecture.md` — read before refactoring `src/index.ts`, `src/composition.ts`, editor lifecycle wiring, editor chrome, file-picker runtime/config behavior, status-bar rendering, footer integration, git invalidation, or any feature that wants to own `setEditorComponent()`.

## Maintenance rules

- List cross-cutting docs in `CONTEXT-MAP.md` with plain-language guidance for when agents should read them.
- Keep entries stable, source-grounded, and small.
- Keep root `README.md` public-facing; put maintainer implementation notes under `docs/`.
- Never put secrets, credentials, private keys, tokens, or raw sensitive logs in context docs.
