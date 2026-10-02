# ADR-002: Drizzle ORM with hand-reviewed SQL migrations

Status: Accepted · 2026-10-02

## Context
The brief requires hand-reviewed SQL migrations, partial indexes, `CONCURRENTLY` index
builds, generated columns, `citext`, GIN/trigram indexes and later partitioning (§7.13,
§22.2). It also lets us choose Prisma or Drizzle.

## Decision
Use Drizzle ORM (`drizzle-orm` + `drizzle-kit`) with PostgreSQL via `node-postgres`.
- Schema is declared in TypeScript per module; `drizzle-kit generate` produces SQL which
  is reviewed and edited by hand before commit. Migrations that need `CONCURRENTLY` are
  written by hand and run outside a transaction.
- Raw SQL only through Drizzle's `sql` tagged template (parameterised), reviewed in PRs.
- Zod schemas for DTOs live in `packages/shared`; DB row types never leave repositories.

## Consequences
- SQL stays visible and close to what runs; no query engine binary in the image.
- Fewer batteries than Prisma (no Prisma Studio, smaller ecosystem). Acceptable.
- Exact versions pinned at M0 after checking release notes (brief §4.5).

## Alternatives considered
- Prisma: good DX, but migrations are generated from its own schema language, and partial
  or concurrent indexes, generated columns and custom check constraints need manual SQL
  edits that the next `migrate dev` may fight. Rejected for this schema.
- Kysely or raw `pg`: maximum control, but no schema-as-code; more boilerplate. Kept as an
  escape hatch for complex read queries if Drizzle's builder gets in the way.

## Amendment · M0 · 2026-10-02
Migrations are plain SQL files in `apps/api/migrations/NNNN_name.sql`, applied in order by
our own runner (`apps/api/src/db/migrate.ts`) instead of `drizzle-kit migrate`. The runner
takes a Postgres advisory lock, runs each file in its own transaction, records a SHA-256
checksum in `schema_migrations`, and refuses to start if an applied file changed. A file
whose first line is `-- elega:no-transaction` runs outside a transaction (for
`CREATE INDEX CONCURRENTLY`). `drizzle-kit generate` stays available to draft SQL from the
TypeScript schema, but its output is copied into a numbered file and reviewed by hand.
Reason: one ordered list of reviewed SQL files, no second journal format to keep in sync.
