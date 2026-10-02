# Contributing

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (checked by
  commitlint in a git hook and in CI).
- Code, identifiers, commit messages and technical docs are in English; user-facing text
  lives in `packages/i18n/messages/{ru,en}.json`, Russian first.
- Dependencies are pinned to exact versions (`.npmrc` has `save-exact=true`). Read the
  release notes before upgrading a major version.
- No secrets, real user data or production configuration in the repository: it is public.

## Architecture rules

- The API is a modular monolith ([ADR-001](docs/adr/001-modular-monolith.md)). A module in
  `apps/api/src/modules/<name>` imports another module only through its `index.ts`, and
  `platform`, `config` and `db` never import modules. ESLint enforces both.
- Every endpoint is described in `docs/api/openapi.yaml` first; an integration test fails
  if the API serves a route the spec does not document. Run `pnpm api:generate` after
  changing the spec.
- Errors use the unified body `{ error: { code, message, details?, requestId } }`; throw
  `AppError` for expected failures. Unknown errors are logged and returned as
  `internal_error` without their message.
- Migrations are numbered SQL files in `apps/api/migrations`. Never edit one that has been
  applied; add a new file.

## Before opening a pull request

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```
