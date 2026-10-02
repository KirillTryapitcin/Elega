# ADR-004: Auth tokens and session model

Status: Proposed · 2026-10-02

## Context
Brief §8.4: short-lived access JWT, rotating refresh tokens with reuse detection, cookie
for refresh, CSRF protection, a session list with remote logout.

## Decision
- Access token: JWT signed with Ed25519 (`EdDSA`), 15 min, claims `sub`, `sid`, `role`,
  `minor`, `kid`. Keys rotate via `kid`; the public key set is served internally only.
  Sent as `Authorization: Bearer`, held in memory by the web client (never localStorage).
- Refresh token: 256-bit random, only its SHA-256 stored in `sessions.refresh_token_hash`.
  Cookie `__Host-elega_rt`, `HttpOnly; Secure; SameSite=Lax; Path=/` (the `__Host-`
  prefix requires `Path=/`); only `POST /auth/refresh` and `/auth/logout` read it, and
  every other endpoint ignores cookies and authenticates by bearer token only. 30-day sliding expiry when "remember this device"
  is on; otherwise a browser-session cookie with a 12-hour server-side limit.
- Rotation: each refresh creates a new `sessions` row with the same `family_id` and
  `rotated_from_id`, and revokes the old one. Presenting a revoked token revokes the whole
  family and emits `session:revoked` (reuse detection).
- CSRF: the refresh and logout endpoints require the header `X-Elega-CSRF: 1` (custom
  header, not sendable cross-origin without CORS preflight) and check `Origin`.
- Password reset, password change and 2FA changes revoke all other sessions.
- WebSocket authenticates with the access token on connect and re-authenticates on
  refresh; revocation pushes `session:revoked` and disconnects.

## Consequences
- Stolen access tokens live at most 15 minutes; stolen refresh tokens are detected on the
  next use by either party.
- Every request validates the JWT locally; a revoked session's access token stays valid
  until expiry. Admin bans additionally check a Redis deny-list of session ids.

## Alternatives considered
- Server sessions only (cookie + Redis lookup per request): simpler revocation, but couples
  every request to Redis and complicates the WebSocket gateway. Kept as the fallback.
- Long-lived JWTs: no revocation. Rejected.
