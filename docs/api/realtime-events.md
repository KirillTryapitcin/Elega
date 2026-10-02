# Realtime event contract

Status: accepted with the Step 2 blueprint. At M6 these become Zod schemas in
`packages/shared/src/realtime/` and the typed Socket.IO client is generated from them
([ADR-005](../adr/005-realtime-transport.md)).

Transport: Socket.IO at `/socket.io`, auth with the access token in the handshake
(`auth: { token }`). Every server → client event carries `eventId` (monotonic per user,
from the Redis stream `events:user:{id}`) so the client can resume with
`hello { lastEventId }` after a reconnect.

## Client → server

| Event | Payload | Checks | Ack |
| --- | --- | --- | --- |
| `hello` | `{ lastEventId? }` | — | `{ replayed: n, needsRestSync: bool }` |
| `chat:send` | `{ conversationId, clientMessageId, type, body?, mediaId?, replyTo? }` | member, not blocked, request rules, rate limit (new accounts lower) | `{ message }` or `{ error }` |
| `chat:typing` | `{ conversationId, isTyping }` | member; debounced 3 s, expires 6 s | none |
| `chat:read` | `{ conversationId, lastReadMessageId }` | member | none |
| `presence:ping` | `{}` | every 25 s while visible | none |
| `subscribe:conversation` | `{ conversationId }` | member | `{ ok }` |
| `unsubscribe:conversation` | `{ conversationId }` | — | `{ ok }` |

## Server → client

| Event | Payload | Room |
| --- | --- | --- |
| `chat:message` | `{ eventId, message }` | `conversation:{id}` |
| `chat:message_updated` | `{ eventId, message }` | `conversation:{id}` |
| `chat:message_deleted` | `{ eventId, messageId, conversationId, forAll }` | `conversation:{id}` |
| `chat:receipt` | `{ eventId, messageId, userId, status: delivered \| read }` | sender's `user:{id}` (only if both have read receipts on) |
| `chat:typing` | `{ conversationId, userId, isTyping }` | `conversation:{id}` (not stored, no `eventId`) |
| `presence:update` | `{ userId, status, lastSeenAt? }` | users allowed by `who_can_see_online_status`, reciprocity rule |
| `notification:new` | `{ eventId, notification }` | `user:{id}` |
| `notification:count` | `{ unread }` | `user:{id}` |
| `feed:new_posts` | `{ count }` | `user:{id}` |
| `friend:request` | `{ eventId, request }` | `user:{id}` |
| `friend:accepted` | `{ eventId, userId }` | `user:{id}` |
| `story:new` | `{ userId }` | `user:{id}` of viewers in audience |
| `media:status` | `{ mediaId, status }` | uploader's `user:{id}` |
| `session:revoked` | `{}` | that session only; server disconnects after emit |
| `error` | `{ code, message }` | socket |

## Rules

- Payloads validated with Zod both ways; unknown fields rejected.
- Per-connection limit 20 events/s burst, 5/s sustained; per-user `chat:send` limits mirror
  REST.
- Message bodies never go to logs; only ids and sizes.
- Blocks are checked on every send and on room join; a new block removes both users from
  each other's direct conversation room immediately.
