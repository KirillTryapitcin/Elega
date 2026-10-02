# ADR-009: ID strategy

Status: Accepted · 2026-10-02

## Context
IDs appear in URLs and cursors, must not reveal counts, should be time-sortable for keyset
pagination and index locality (§7).

## Decision
UUIDv7 (RFC 9562) stored as native `uuid` (16 bytes). Generated in the application with
the `uuid` npm package (`v7()`); the database has `uuid_generate_v7()` as a fallback
default (PostgreSQL 16 has no built-in v7; PostgreSQL 18 adds `uuidv7()`).

## Consequences
- B-tree inserts are append-mostly; `ORDER BY id` approximates creation time, so
  `messages (conversation_id, id DESC)` needs no separate timestamp index.
- IDs leak creation time to millisecond precision. Acceptable for social content; never
  used as secrets (tokens are separate random values).

## Alternatives considered
- ULID in `char(26)`: same ordering, 26 bytes of text instead of 16, no native type.
- `bigserial`: compact, but enumerable and reveals volume.
- UUIDv4: random inserts fragment indexes.
