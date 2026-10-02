# Elega

Elega (elega.ru) is a calm, privacy-respecting social network for Russian-speaking users:
a chronological feed by default, explicit audience control on every post and profile field,
strong tools for community moderators, and all personal data stored in Russia.

Status: milestone M1 (auth and accounts). The technical blueprint is in [`docs/`](docs/README.md);
progress is tracked in [`docs/progress.md`](docs/progress.md).

## Quick start

Requirements: Docker with Compose v2. For development outside containers also Node.js 22
(`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
docker compose up --build
```

| URL                                 | What                               |
| ----------------------------------- | ---------------------------------- |
| http://localhost:8080               | Web app (through Caddy)            |
| http://localhost:8080/api/v1/readyz | API readiness (Postgres, Redis)    |
| http://localhost:8025               | Mailpit, catches all outgoing mail |
| http://localhost:8333               | S3-compatible storage (SeaweedFS)  |

All credentials in `docker-compose.yml` and `.env.example` are local-only placeholders that
contain `local_only`; the API and worker refuse to start with them when `APP_ENV` is
`production` or `staging` (it defaults to `production` in production builds).

## Development

```sh
pnpm install
cp .env.example .env
pnpm dev            # starts postgres, redis, s3, mailpit in Docker and the apps with reload
pnpm db:migrate     # apply SQL migrations from apps/api/migrations
pnpm --filter @elega/api build && pnpm seed   # demo accounts and invite codes (local only)
```

Registration is invite-only. `pnpm seed` prints reusable local invite codes and the demo
password; in the Compose stack run `docker compose exec api node dist/cli/seed.js`. For
staging and production, create codes with the invite CLI, which only needs `DATABASE_URL`:

```sh
docker compose exec api node dist/cli/invites.js --count 5 --max-uses 1 --expires-days 30 --note "wave 1"
```

| Command                                      | Does                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint, TypeScript, unit tests                                                |
| `pnpm test:integration`                      | API and worker against real Postgres and Redis (Testcontainers, needs Docker) |
| `pnpm test:e2e`                              | Playwright tests against the running Compose stack (creates its own invite)   |
| `pnpm build`                                 | Build every app and package                                                   |
| `pnpm storybook`                             | UI kit in light and dark themes                                               |
| `pnpm api:generate`                          | Regenerate `packages/api-client` from `docs/api/openapi.yaml`                 |

## Layout

| Path                  | Contents                                              |
| --------------------- | ----------------------------------------------------- |
| `apps/api`            | NestJS + Fastify API (`/api/v1`), SQL migrations      |
| `apps/worker`         | BullMQ background jobs                                |
| `apps/web`            | Next.js PWA (App Router), includes `/admin` from M11a |
| `packages/shared`     | Zod schemas and types shared by API and clients       |
| `packages/api-client` | Typed client generated from the OpenAPI spec          |
| `packages/ui`         | Design system: Dusk tokens, components, Storybook     |
| `packages/i18n`       | Russian and English ICU message catalogs              |
| `packages/config`     | Shared TypeScript presets                             |
| `infra/`              | Dockerfile, Caddy, SeaweedFS config                   |
| `tests/e2e`           | Playwright smoke tests                                |

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [SECURITY.md](SECURITY.md) to
report a vulnerability.
