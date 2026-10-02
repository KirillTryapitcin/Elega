# ADR-011: Login providers

Status: Proposed · 2026-10-02 · Decided with Kirill in the project thread on 2026-10-02

## Context
The audience is Russian-speaking users in the RF and CIS (§2). The brief lists Google as
required and VK ID / Yandex ID as recommended (§8.8). Google sign-in sends personal data
abroad and its availability in the RF is not reliable.

## Decision
- Primary sign-in: email + password, VK ID and Yandex ID, all in M1.
- VK ID via its OAuth 2.1 flow with PKCE; Yandex ID via OAuth 2.0 authorization code with
  PKCE. Exact endpoints and scopes taken from each provider's current documentation at M1.
- Google OAuth implemented behind the feature flag `auth.google`, off by default; enabling
  it requires a legal review of the cross-border transfer.
- Linking: an external identity whose verified email matches an existing account is linked
  only after the user signs in to that account (prevents takeover by email collision).
  Accounts created through OAuth still record birthdate and consents before activation.

## Consequences
- Lower sign-up friction for the core audience and no default cross-border transfer.
- Two provider apps (VK, Yandex) must be registered by Kirill with the production domain
  and redirect URIs; client secrets go into the secret store, never the repo.

## Alternatives considered
- Google as a required provider (brief default): rejected for the residency reason above.
