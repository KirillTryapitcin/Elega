# Progress log

Running status so work can resume after interruptions (brief §35.10). Newest first.

| Date | Step | Status | Notes |
| --- | --- | --- | --- |
| 2026-10-02 | Step 3 · M0 Foundations | In review | Draft PR `feat/m0-foundations`. Report below. |
| 2026-10-02 | Step 2 · Technical blueprint | Approved | Architecture, 11 ADRs (Accepted), schema draft (applied to PG 16), OpenAPI draft (177 operations, lint clean), realtime contract, authorization matrix, scaffolding plan. Design direction B · Dusk chosen. |
| 2026-10-02 | Step 1 · Product plan | Approved | Plan doc: https://claude.ai/code/artifact/d92f9f9c-0c00-407e-90dd-9037c6a54072. Basic moderation (M11a) moved right after chat (M7) so a closed alpha can start earlier. VK ID + Yandex ID primary login. |
| 2026-10-02 | Step 0 · Clarify | Done | All seven defaults accepted. |

## M0 report

**Done.** pnpm + Turborepo monorepo (Node 22.23, TypeScript 6.0, exact pins). API: NestJS 12 on
Fastify, Zod-validated env, pino JSON logs with request ids and redaction, unified error body,
`/api/v1/healthz` and `/api/v1/readyz`, Helmet headers, SQL migration runner with checksums and
an advisory lock, module-boundary lint rules. Worker: BullMQ with a heartbeat job and a health
endpoint. Web: Next.js 16 shell, Russian by default with English, light/dark/system theme kept in
a cookie (no flash), Onest self-hosted, PWA manifest, baseline CSP. Design: Dusk tokens and a
base kit (Button, Card, Input, Avatar, Badge) in Storybook. Generated API client. Compose stack
(Postgres 16.15, Redis 7.4, SeaweedFS, Mailpit, Caddy). CI: format, lint, typecheck, unit,
integration, Storybook build, client sync, audit, compose + Playwright e2e, gitleaks, CodeQL.

**Verified (locally, 2026-10-02).** 30 unit tests, 9 integration tests against real Postgres and
Redis, 12 Playwright tests (mobile + desktop, incl. axe) against the running stack; all 8
services healthy; lint and format clean; `pnpm audit --prod` clean; Storybook screenshots in
both themes. The local Docker build needed the sandbox proxy CA passed as a build secret; the
plain `docker compose up --build` from a clean clone is proven by the `stack` CI job.

**Decisions.** Spec-first OpenAPI (nestjs-zod lacks NestJS 12 support); SeaweedFS instead of
MinIO (no community images); Dependabot instead of Renovate; `APP_ENV` separate from
`NODE_ENV` so production safeguards cannot be bypassed by a build flag; own migration runner
(ADR-002 amendment); see the table in [scaffolding-plan.md](scaffolding-plan.md).

**Risks.** CSP still allows inline scripts (nonces with M1). Redis 7.4 is under RSALv2/SSPL
(self-hosting is allowed; Valkey is a drop-in if needed). Observability profile, DB roles
(`elega_migrator`/`elega_app`) and the policy matrix code are deferred to the milestones listed
in the scaffolding plan. Indigo primary sits near VK's blue.

**Real-user risk.** None yet: no accounts, no personal data, nothing deployed.

## Next

M1 Auth and accounts: registration with email verification, VK ID and Yandex ID login,
sessions with rotating refresh tokens, password reset, 2FA, age gate (14+), seed data with
the production guard, policy matrix as code, CSP nonces.
