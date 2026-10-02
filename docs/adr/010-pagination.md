# ADR-010: Pagination

Status: Proposed · 2026-10-02

## Context
Every list must be bounded and stable while new items arrive; OFFSET is banned on large
tables (§22.2, §26.1).

## Decision
- Keyset (cursor) pagination everywhere: `?limit=20&cursor=<opaque>`, response
  `{ data: [...], page: { nextCursor, hasMore } }`.
- Cursor = base64url of a versioned JSON `{v:1, k:[<sort key>, <id>]}`, HMAC-signed so
  clients cannot forge arbitrary positions; invalid cursor → `400 validation_failed`.
- Sort keys: `(created_at, id)` for chronological lists, `(score, id)` for ranked feed
  (score frozen in the cursor), `(id)` for messages.
- `limit` default 20, max 50 (100 for admin lists).
- "New items" uses a separate `since` endpoint (`/feed/new-count?since=`), never page
  shifting.

## Consequences
- Constant-time pages regardless of depth; no duplicates or gaps when items are inserted.
- No "jump to page N"; fine for social feeds, admin lists use filters instead.

## Alternatives considered
- OFFSET/LIMIT: slow and unstable on large tables. Rejected.
- Exposing raw ids as cursors: leaks sort internals and breaks when the sort changes.
