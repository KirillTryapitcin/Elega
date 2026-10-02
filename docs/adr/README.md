# Architecture Decision Records

Format: Context, Decision, Consequences, Alternatives considered. Status is `Proposed` until
Kirill approves the Step 2 blueprint, then `Accepted`. A later change gets a new ADR that
supersedes the old one; accepted ADRs are not edited.

| # | Decision | Status |
| --- | --- | --- |
| [001](001-modular-monolith.md) | Modular monolith, not microservices | Accepted |
| [002](002-orm-drizzle.md) | Drizzle ORM with hand-reviewed SQL migrations | Accepted |
| [003](003-feed-hybrid-fanout.md) | Hybrid fan-out feed (write < 5000, read above) | Accepted |
| [004](004-auth-tokens-sessions.md) | Short JWT access + rotating opaque refresh in cookie | Accepted |
| [005](005-realtime-transport.md) | Socket.IO with Redis adapter and resumable event ids | Accepted |
| [006](006-media-pipeline.md) | Presigned uploads, worker processing, separate content domain | Accepted |
| [007](007-search-provider.md) | PostgreSQL FTS + pg_trgm behind a SearchProvider interface | Accepted |
| [008](008-data-residency-hosting.md) | All personal data hosted in RF; Selectel for MVP | Accepted |
| [009](009-id-strategy.md) | UUIDv7 primary keys | Accepted |
| [010](010-pagination.md) | Opaque keyset cursors only | Accepted |
| [011](011-login-providers.md) | Email, VK ID and Yandex ID primary; Google behind a flag | Accepted |
