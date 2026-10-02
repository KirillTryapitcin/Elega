# ADR-007: Search provider abstraction

Status: Proposed · 2026-10-02

## Context
Search covers people, groups, pages, events, public posts and hashtags with typeahead
under 150 ms p95 (§17). Russian morphology, ё/е equivalence and transliteration matter.

## Decision
- Interface `SearchProvider { index, remove, search, suggest }` in the search module.
- MVP implementation on PostgreSQL:
  - `search_normalize()` = lower-case + `unaccent` + ё→е, used in every indexed
    expression and query.
  - Posts: stored `tsvector` (russian + english configs), GIN index, public posts only.
  - Names, usernames, group and page names, hashtags: `pg_trgm` GIN indexes for fuzzy
    and prefix matching.
  - Transliteration: queries in Latin are also searched in a Cyrillic transliteration
    (GOST 7.79-2000 system B table in code) and vice versa.
- Privacy in the query: blocks in both directions excluded in SQL; minors returned only to
  their friends; secret groups never returned to non-members; users who opted out of
  discoverability by email or phone are not matched on those fields.
- Index updates by `search.index` jobs on domain events; `pnpm search:reindex` rebuilds.

## Consequences
- No extra service to run for MVP; ranking is simpler than a dedicated engine.
- Switching to Meilisearch or OpenSearch later means a second provider implementation and
  a reindex, not changes in callers.

## Alternatives considered
- Meilisearch from day one: better typo tolerance and ranking, but another stateful
  service and data copy to secure. Revisit when PG search p95 exceeds target.
