# Security controls

What protects accounts and data today, with the parameters an auditor will ask about.
Token and session design: [ADR-004](adr/004-auth-tokens-sessions.md). Sign-in providers:
[auth-providers.md](auth-providers.md). Reporting vulnerabilities: [SECURITY.md](../SECURITY.md).

## Passwords

- Length 10 to 256 characters, any characters. Rejected when zxcvbn scores it below 2 with
  the user's email, username and name as extra dictionary words. The zxcvbn common-password
  and dictionary lists are the offline "known weak password" check; no password or hash
  prefix ever leaves the server (no HIBP calls).
- Hashing: argon2id, memory 19 MiB (19456 KiB), 2 iterations, parallelism 1 (OWASP
  Password Storage Cheat Sheet minimum). Hashes are upgraded on the next sign-in when the
  parameters change. Unknown accounts are verified against a dummy hash so timing does not
  reveal whether an account exists.

## Sign-in protection

| Limit | Value |
| --- | --- |
| Global, per IP | 600 requests / min (fails open with a warning if Redis is down) |
| Sign-up, per IP | 5 / hour; per email 3 / day |
| Sign-in attempts, per IP | 30 / 15 min |
| Failed sign-ins, per identifier | 5 / 15 min, 20 / day, then 429 until the window passes |
| Failed sign-ins, per IP | 50 / hour (credential stuffing) |
| 2FA codes, per IP | 10 / 15 min; each challenge allows 5 tries and lives 5 min |
| Password reset requests | 5 / hour per IP, 3 / hour per email (silently dropped beyond) |
| Sensitive account changes | 10 / hour per user |

Every 429 carries `Retry-After` and `RateLimit-*` headers. Identifiers are rate-limited by
HMAC, never stored in clear in Redis. A successful password reset lifts the lockout.

CAPTCHA: the sign-up and sign-in paths call a `Captcha` interface that is a no-op today
(`NoCaptcha`). Turning on a provider (Yandex SmartCaptcha is the candidate) is a config and
adapter change; it is not needed while registration is invite-only.

## Tokens, cookies and CSRF

- Access token: EdDSA JWT, 15 minutes, in memory only. Refresh token: 256 bits, stored as
  SHA-256, in `__Host-elega_rt` (`HttpOnly; Secure; SameSite=Lax; Path=/`). Rotation on every
  refresh; replay after a 5-second grace window revokes the whole session family.
- `__Host-elega_signed_in=1` is readable by scripts and holds no secret; it only tells the
  web app whether a refresh is worth trying.
- Refresh and logout, the only endpoints that read cookies, require `X-Elega-CSRF: 1`, an
  `Origin` equal to `APP_BASE_URL` and `Sec-Fetch-Site` of `same-origin` (or absent).
- One-time tokens (email verification, password reset, email change, OAuth sign-up and MFA
  hand-offs) travel in the URL fragment, which browsers never send to servers, and the web
  app removes them from the address bar after reading them.

## Account changes

- Password change, email change, enabling or disabling 2FA and "sign out everywhere" require
  re-authentication: the current password (or, for accounts without one, a sign-in in the
  last 10 minutes) plus a 2FA code when 2FA is on.
- Password reset and password change end all other sessions; the account owner gets an
  email for password changes, new-device sign-ins, 2FA changes, linked providers and email
  change requests (sent to the old address too).
- Staff accounts (moderator, analyst, admin) cannot turn 2FA off. The admin area (M11)
  will additionally refuse staff sessions without 2FA.

## Two-factor authentication

TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step). The 20-byte secret is encrypted with
AES-256-GCM under a versioned key; each code works once (Redis marks the time step as used).
10 single-use recovery codes, 10 characters each, stored as SHA-256 hashes and shown once.

## Keys and secrets

`APP_SECRET` (32+ random characters) is the root secret. HKDF derives separate keys for
PII hashing (IP addresses), cursor and OAuth state signing, JWT signing and TOTP encryption.
`AUTH_JWT_KEYS` and `AUTH_TOTP_KEYS` override the derived keys with explicit `id:secret`
lists for rotation (newest first). Production refuses to start with any value containing the
local-only marker or with a non-https `APP_BASE_URL`.

## Minors (14–17)

Sign-up requires age 14+. Accounts under 18 start with private defaults (messages and
mentions from friends only, friend requests from friends of friends, no followers, not
indexed, not findable by email, posts to friends) and cannot loosen those settings
(`403 not_allowed_for_minors`). The `minor` flag is in the access token for later policy
checks.

## Content Security Policy (web)

Set per request in `apps/web/src/proxy.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'`,
no inline scripts without the nonce, `object-src 'none'`, `frame-ancestors 'none'`,
`base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` on https. Styles allow
`'unsafe-inline'` (style attributes; CSS cannot run script). The API sends its own strict
headers through Helmet.

## Logging and audit

Logs never contain passwords, tokens, codes, cookies or authorization headers (pino redaction)
and record request paths without query strings. Every sign-in attempt, successful or not, is
written to `login_attempts`. Security events go to the append-only `audit_log` with an HMAC
of the IP address: registration, sign-in (`session.created`), refresh-token reuse, sign-out
everywhere, email verification and change, password reset and change, 2FA on and off,
provider link and unlink, cancelled deletion and invite creation. Revoking a single other
session is not audited yet.

## Known gaps

- Legal documents are placeholders; real users must not be invited before they are drafted
  and reviewed (see `docs/progress.md`).
- `409 email_taken` on sign-up reveals that an address is registered. Accepted for usability;
  limited by the per-IP and per-email sign-up limits.
- No GeoIP: the sessions list shows device names, not locations.
