# ADR-005: Realtime transport

Status: Proposed · 2026-10-02

## Context
Chat, receipts, typing, presence, notifications and the "new posts" pill need server push
(§14.4, §27). Users are mostly on mobile networks that drop connections.

## Decision
- Socket.IO (server in the NestJS gateway, client wrapped in a typed layer generated from
  the Zod event schemas in `packages/shared`). WebSocket first, long-polling fallback.
- `@socket.io/redis-adapter` for horizontal scale; rooms `user:{id}` and
  `conversation:{id}`.
- Auth on connect with the access token; every `subscribe:*` and `chat:*` re-checks
  membership and blocks through the chat service.
- Resume: each user-visible event gets a monotonically increasing id from a per-user Redis
  stream (`XADD events:user:{id} MAXLEN ~ 1000`). On reconnect the client sends
  `lastEventId`; the gateway replays from the stream, and if the id is older than the
  stream the client refetches via REST (`GET /conversations/{id}/messages?after=`).
- At-least-once delivery; messages are idempotent by `(sender_id, client_message_id)`.
- Per-connection and per-user rate limits; payloads validated with Zod; heartbeats
  25 s; client reconnect with exponential backoff and jitter.

## Consequences
- Socket.IO's fallback and reconnection logic work on flaky mobile networks without custom
  code; the cost is its own protocol (not raw WebSocket) and a slightly larger client.
- Redis becomes required for realtime; it already is for queues and rate limits.

## Alternatives considered
- Raw WebSocket (`ws`): lighter, but we would rebuild rooms, acks, fallback and
  reconnection. Rejected for MVP.
- Server-Sent Events + REST: fine for notifications, awkward for typing and acks.
- Centrifugo: strong option at scale, but an extra service to operate. Revisit past
  ~50 k concurrent connections.
