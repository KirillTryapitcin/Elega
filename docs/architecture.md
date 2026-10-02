# Architecture

Status: accepted with the Step 2 blueprint. Decisions are recorded in [`docs/adr`](adr/).

Elega is a modular monolith: one NestJS API process (HTTP + WebSocket), one worker process
from the same codebase, PostgreSQL, Redis and S3-compatible storage, all hosted in Russia.
The web app is a Next.js PWA. Services are extracted only when metrics justify it
([ADR-001](adr/001-modular-monolith.md)).

## System context

```mermaid
flowchart LR
  user([Users: web / PWA])
  mod([Moderators and admins])
  subgraph elega[Elega platform, hosted in RF]
    sys[Elega]
  end
  vk[VK ID]
  ya[Yandex ID]
  google[Google OAuth<br/>off by default]
  smtp[SMTP provider in RF]
  push[Browser push services<br/>FCM / Mozilla / Apple]
  captcha[Yandex SmartCaptcha]

  user -- HTTPS / WSS --> sys
  mod -- HTTPS, 2FA --> sys
  sys -- OAuth 2.1 + PKCE --> vk
  sys -- OAuth 2.0 --> ya
  sys -.->|flag| google
  sys -- transactional email --> smtp
  sys -- Web Push, encrypted payload --> push
  sys -- token check --> captcha
```

Web Push payloads are end-to-end encrypted to the browser (RFC 8291) and carry no message
text, only a notification id the client fetches from the API. Push services outside the RF
still see the subscription endpoint and timing; that residual transfer goes on the legal
checklist. Google login stays behind a flag because it means cross-border transfer
([ADR-011](adr/011-login-providers.md)).

## Containers

```mermaid
flowchart TB
  browser[Browser / PWA<br/>Next.js client, service worker]
  subgraph edge[Edge]
    proxy[Caddy<br/>TLS, HTTP/2+3, request id, size limits]
  end
  subgraph app[Application]
    web[web<br/>Next.js SSR]
    api[api<br/>NestJS + Fastify<br/>REST /api/v1 + Socket.IO]
    worker[worker<br/>BullMQ consumers<br/>sharp, ffmpeg]
  end
  subgraph data[Data]
    pg[(PostgreSQL 16<br/>+ PgBouncer)]
    redis[(Redis 7<br/>cache, rate limits,<br/>queues, pub/sub, streams)]
    s3[(Object storage<br/>private + public buckets)]
  end
  cdn[CDN<br/>usercontent.elega.ru]
  obs[Observability<br/>Prometheus, Grafana, Loki,<br/>OTel collector, GlitchTip]

  browser --> proxy
  browser -- presigned PUT --> s3
  browser -- media GET --> cdn
  cdn --> s3
  proxy --> web
  proxy -- /api, /socket.io --> api
  web -- server fetch --> api
  api --> pg
  api --> redis
  api -- presign --> s3
  worker --> pg
  worker --> redis
  worker --> s3
  api -. metrics, traces, logs .-> obs
  worker -. metrics, traces, logs .-> obs
  web -. metrics, traces, logs .-> obs
```

User content is served from a separate registrable domain (`elega-usercontent.ru` or
similar) rather than a subdomain, so uploaded files can never read or set `elega.ru`
cookies. The brief suggests `usercontent.elega.ru`; a subdomain shares the registrable
domain, so it is weaker isolation. This is a deviation recorded in
[ADR-006](adr/006-media-pipeline.md).

## Module dependencies

Arrows mean "calls the public service of". Reactions to other modules' changes go through
domain events (outbox), drawn dashed.

```mermaid
flowchart LR
  platform[platform<br/>flags, rate limits, config]
  auth --> users
  users --> media
  relationships --> users
  posts --> relationships
  posts --> media
  posts --> users
  feed --> posts
  feed --> relationships
  stories --> relationships
  stories --> media
  chat --> relationships
  chat --> media
  groups --> users
  groups --> media
  events --> groups
  events --> relationships
  search --> users
  search --> relationships
  moderation --> posts
  moderation --> users
  admin --> moderation
  admin --> platform

  posts -.->|post.created| feed
  posts -.->|post.created| notifications
  posts -.->|post.created| search
  relationships -.->|friendship.accepted| feed
  relationships -.->|block.created| feed
  chat -.->|message.sent| notifications
  moderation -.->|content.removed| notifications
```

Every module may depend on `platform`. The visibility check that every content query uses
(audience × relationship × blocks × minors) lives in `relationships` as one public function,
`VisibilityService.filterVisible(viewer, items)`, plus a SQL fragment builder for list
queries, so no module reimplements block rules (brief §10.4).

## Request lifecycle

1. Caddy terminates TLS, assigns `X-Request-Id`, enforces body size per route.
2. Fastify middleware: request id into the pino logger and OTel span, security headers,
   rate limit (Redis sliding window per IP, user and endpoint class).
3. Auth guard verifies the access JWT and loads the principal (user id, role, session id,
   minor flag, trust level).
4. Zod validation pipe with schemas from `packages/shared`.
5. Policy guard (CASL) checks the action on the specific resource; loaders fetch the
   resource once and pass it on.
6. Controller → service → repository (Drizzle).
7. Side effects written to `outbox` in the same transaction.
8. Response mapped through explicit DTOs.
9. Exceptions mapped to the unified error format with the request id.

## Sequences

### Login (password, with 2FA)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as api
  participant R as Redis
  participant P as Postgres
  B->>A: POST /auth/login {identifier, password, captchaToken?}
  A->>R: rate limit check (ip, identifier hash)
  A->>P: load user + credential
  A->>A: argon2id verify (constant time, dummy hash if no user)
  A->>P: insert login_attempts
  alt 2FA enabled
    A-->>B: 200 {mfaRequired, mfaToken (5 min)}
    B->>A: POST /auth/login/2fa {mfaToken, code}
    A->>A: verify TOTP or recovery code
  end
  A->>P: insert sessions (family_id, refresh hash)
  A-->>B: 200 {accessToken} + Set-Cookie __Host-refresh (HttpOnly, Secure, SameSite=Lax)
  A--)B: new device → security email via outbox
```

### Create post

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as api
  participant P as Postgres
  participant W as worker
  participant R as Redis
  B->>A: POST /posts (Idempotency-Key) {body, audience, mediaIds}
  A->>A: validate, policy, abuse checks (rate, duplicate hash, banned terms)
  A->>P: one transaction: posts, post_media, mentions, hashtags + outbox post.created
  A-->>B: 201 {post}
  W->>P: outbox.relay reads unpublished events
  W->>R: XADD domain-events
  par fan-out
    W->>P: feed.fanout inserts feed_entries (authors < 5000 audience)
    W->>R: publish feed:new_posts to followers' rooms
  and notifications
    W->>P: notifications for mentions
  and search
    W->>P: search.index (public posts only)
  end
```

### Feed load

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as api
  participant R as Redis
  participant P as Postgres
  B->>A: GET /feed?mode=chronological&cursor=
  A->>R: first page cache (30 s TTL, invalidated on own post / block)
  alt cache miss
    A->>P: feed_entries page (keyset) for viewer
    A->>P: recent posts of followed high-fan-out authors (pages, > 5000)
    A->>A: merge, filter visibility, blocks, mutes, hidden, deleted
    opt mode = for_you
      A->>A: score = freshness × (affinity + engagement) × diversity
    end
    A->>R: cache page 1
  end
  A-->>B: {data, page: {nextCursor, hasMore}}
```

### Send message

```mermaid
sequenceDiagram
  autonumber
  participant S as Sender
  participant G as api (Socket.IO)
  participant P as Postgres
  participant R as Redis adapter
  participant T as Recipient
  S->>G: chat:send {conversationId, clientMessageId, body}
  G->>G: membership + message-request + block checks, rate limit
  G->>P: insert message, ON CONFLICT (sender_id, client_message_id) DO NOTHING, + outbox
  G-->>S: ack {message, eventId}
  G->>R: emit to room conversation:{id}
  R->>T: chat:message {message, eventId}
  T->>G: chat:read {lastReadMessageId}
  G->>P: update conversation_members.last_read_message_id
  G->>R: chat:receipt to sender
  Note over T,G: On reconnect the client sends lastEventId and fetches missed messages via REST
```

### Upload media

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as api
  participant S as Object storage
  participant W as worker
  B->>A: POST /media/uploads {kind, size, mime}
  A->>A: quota, size and type limits
  A-->>B: {mediaId, uploadUrl (presigned PUT, 10 min)}
  B->>S: PUT original (progress, cancellable)
  B->>A: POST /media/{id}/complete
  A->>W: enqueue media.process
  W->>S: read original
  W->>W: magic bytes, decompression-bomb guard, AV hook, strip EXIF
  W->>W: variants 160/320/720/1440 AVIF+WebP+JPEG, blurhash, video → HLS 360/720/1080
  W->>S: write variants to public or private bucket
  W->>A: status ready (or rejected) → realtime update to uploader
```

### Report content

```mermaid
sequenceDiagram
  autonumber
  participant U as Reporter
  participant A as api
  participant P as Postgres
  participant M as Moderator
  participant O as Owner of content
  U->>A: POST /reports {targetType, targetId, reason}
  A->>P: dedupe open report on same target, set priority (self_harm and child_safety = 0)
  A-->>U: 201 {status: open} (+ helpline info if self_harm)
  M->>A: GET /admin/reports (queue)
  M->>A: POST /admin/reports/{id}/action {action, reason, policyRef}
  A->>P: moderation_actions, audit_log, content state, outbox
  A--)O: notification with policy reference and appeal link
  A--)U: report status update
  O->>A: POST /appeals (within 14 days) → second moderator reviews
```

## Deployment

### MVP: one server

```mermaid
flowchart TB
  subgraph vps[VPS in RF: 8 vCPU / 16 GB / NVMe]
    caddy[Caddy]
    web[web x2]
    api[api x2]
    worker[worker x1]
    pgb[PgBouncer]
    pg[(Postgres 16)]
    redis[(Redis 7)]
    mon[Prometheus, Grafana, Loki, GlitchTip]
  end
  s3[(Managed object storage, RF)]
  backup[(Backup bucket, other zone)]
  cdn[CDN, RF]
  caddy --> web & api
  api --> pgb --> pg
  api --> redis
  worker --> pgb
  worker --> redis
  api & worker --> s3
  cdn --> s3
  pg -- WAL-G continuous + daily base --> backup
```

Docker Compose, rolling restarts per service, migrations as a separate one-shot container
before rollout. Sizing is a starting point for the closed alpha, revisited after the k6 run.

### Scale path

Managed PostgreSQL with a read replica and managed Redis, API and worker on Kubernetes
(Helm chart from M12), media workers in their own node pool. Triggers from brief §37.6:
DB CPU > 60 % for 1 h, queue lag > 1 min, WebSocket connections > 20 k per node.
