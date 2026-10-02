# ADR-004: Auth tokens and session model

Status: Accepted · 2026-10-02

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

## Amendment · M1 implementation (2026-10-02)

What the implementation settled that the original decision left open:

- **Keys.** JWT signing keys are derived from `APP_SECRET` with HKDF unless
  `AUTH_JWT_KEYS` (`kid:secret`, newest first) is set; the token header carries `kid` and
  `typ: at+jwt`, issuer `elega`, audience `elega-api`. The same keyring derives the TOTP
  encryption, IP-hashing and state-signing keys ([security.md](../security.md)).
- **Reuse grace.** A rotated refresh token presented again within 5 seconds of its rotation
  gets `401` without revoking anything: two tabs refreshing at once are a race, not theft.
  The web client also serialises refreshes across tabs with a Web Lock. Later reuse revokes
  the family and writes `session.refresh_reuse_detected`.
- **Deny-list for every revocation.** Not only admin bans: every revoked session id goes to
  the Redis deny-list (`auth:denied-sid:<id>`, 15 minutes), so logout, "sign out everywhere"
  and password resets cut off outstanding access tokens immediately.
- **Hint cookie.** `__Host-elega_signed_in=1` (not HttpOnly, no secret) is set and cleared
  with the refresh cookie, so the web app skips the refresh call for anonymous visitors.
- **CSRF.** Besides `X-Elega-CSRF: 1` and `Origin`, the cookie endpoints refuse
  `Sec-Fetch-Site` values other than `same-origin` and `none`.
- **OAuth linking** reads the refresh cookie to identify the signed-in user without rotating
  it ([ADR-011](011-login-providers.md)).
- The WebSocket part (re-auth on refresh, `session:revoked`) lands with the gateway in M6.
