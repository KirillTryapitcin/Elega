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
