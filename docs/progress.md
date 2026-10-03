# Progress log

Running status so work can resume after interruptions (brief §35.10). Newest first.

| Date | Step | Status | Notes |
| --- | --- | --- | --- |
| 2026-10-02 | Step 3 · M1 Auth and accounts | In review | PR `feat/m1-auth`, stacked on M0. Report below. |
| 2026-10-02 | Step 3 · M0 Foundations | In review | PR #2 `feat/m0-foundations`, CI green. Report below. |
| 2026-10-02 | Step 2 · Technical blueprint | Approved | Architecture, 11 ADRs (Accepted), schema draft (applied to PG 16), OpenAPI draft (177 operations, lint clean), realtime contract, authorization matrix, scaffolding plan. Design direction B · Dusk chosen. |
| 2026-10-02 | Step 1 · Product plan | Approved | Plan doc: https://claude.ai/code/artifact/d92f9f9c-0c00-407e-90dd-9037c6a54072. Basic moderation (M11a) moved right after chat (M7) so a closed alpha can start earlier. VK ID + Yandex ID primary login. |
| 2026-10-02 | Step 0 · Clarify | Done | All seven defaults accepted. |

## M1 report

**Scope.** Registration, email verification, sign-in, sessions, password reset, settings shell
(brief §8, §21.3 for minors), plus what M0 deferred: CSP nonces, policy matrix as code, a
guarded seed. Acceptance: a new user can be invited, register, confirm the email, sign in and
out on several devices, recover the password and manage security settings, all covered by
automated tests against real Postgres, Redis and Mailpit.

**Done.**
- Registration: invite-only (hashed single- or multi-use codes), age 14+ with private,
  non-loosenable defaults for 14–17, separate consents (terms, privacy, personal data under
  152-FZ) stored with versions, disposable and blocked email domains rejected, username rules
  with a 14-day change cooldown and a 30-day hold on the old name.
- Sign-in with email or username, "remember this device", per-identifier and per-IP lockout,
  2FA (TOTP + 10 recovery codes), new-device email. VK ID and Yandex ID with PKCE, sign-up
  completion and account linking; Google behind config and the `auth.google` flag.
- Sessions: EdDSA access tokens (15 min), rotating refresh cookie with reuse detection, Redis
  deny-list, session list with per-device and "everywhere" sign-out, CSRF checks.
- Email verification, resend, password reset and change, email change (confirm at the new
  address, notice to the old one); re-authentication for sensitive changes. Transactional
  email through the outbox and the worker, in Russian or English.
- Web: sign-up, sign-in (with the 2FA step), verification, forgot and reset password, OAuth
  completion; settings for account, email, password, 2FA, sessions, linked providers and
  privacy; legal placeholder pages; per-request CSP nonce; ru/en strings with a key check.
- Policy matrix as code (`packages/shared/src/policy/matrix.ts`) with a drift test against
  the document and generated per-cell API tests (M1 row enforced, later rows pending).
- `pnpm seed` (demo accounts and invite codes; refuses outside `APP_ENV` local/test) and a
  production-safe invite CLI. Docs: [security.md](security.md),
  [auth-providers.md](auth-providers.md), ADR-004 and ADR-011 amendments.

**Verified (locally, 2026-10-02).** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`
clean. `pnpm test`: 48 unit tests passed. `pnpm test:integration`: 42 passed (API 40 incl. the
policy cells, worker 2) against Testcontainers Postgres 16, Redis 7 and Mailpit; 58 matrix
cells listed as pending for later milestones. `pnpm audit --prod`: no known vulnerabilities.
Docker images built and the Compose stack healthy; `pnpm seed` ran twice (idempotent).
`pnpm test:e2e`: 17 passed, 1 skipped by design, including register → confirm via Mailpit →
reload → sign out → wrong then right password → sign out everywhere, axe checks on the auth
and settings pages, no browser console errors, and the nonce CSP header.

**Decisions.**
- Age 14+ from launch (Kirill, 2026-10-02).
- Keys derived from `APP_SECRET` with HKDF, overridable key lists for rotation.
- Refresh reuse within 5 s is a race, not theft; every revocation hits the deny-list.
- Non-secret `__Host-elega_signed_in` hint cookie.
- One-time tokens only in URL fragments.
- VK ID and Yandex ID emails treated as unverified; no linking by email.
- `409 email_taken` at sign-up (usability over enumeration resistance, rate-limited).
- CAPTCHA is an interface with a no-op implementation while registration is invite-only.
- Profile editing waits for M2.
- Accounts without a password set one through the reset email.
- The worker image now ships the i18n catalogs (found by the e2e email step).

**Risks / follow-ups.**
- No CAPTCHA provider yet (needed before open registration).
- No GeoIP in the session list.
- The admin 2FA guard comes with M11.
- WebSocket session revocation comes with M6.
- Single-session revocation is not audited.
- The production SMTP provider is not chosen yet.
- VK ID and Yandex ID apps must be registered for the real domain.

**Real-user risk.** Do not invite real users yet. The terms, privacy policy and personal data
consent are placeholders pending legal review, and Roskomnadzor operator notification is not
filed; until both are done, only test accounts.

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

M2 Profiles and media: uploads pipeline (presigned S3, scanning, EXIF strip, variants),
avatar and cover, profile pages, per-field privacy, policy matrix rows for profiles.
