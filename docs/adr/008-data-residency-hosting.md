# ADR-008: Data residency and hosting

Status: Proposed · 2026-10-02

## Context
152-FZ requires primary storage of Russian citizens' personal data in the RF (§21.1). The
MVP is a single server with a path to managed services (§30.5). Budget ceiling is not set.

## Decision
- Every system that stores or processes personal data runs in an RF data centre: app
  server, PostgreSQL, Redis, object storage, backups, logs, error tracking (self-hosted
  GlitchTip), metrics, email delivery (RF SMTP provider), CAPTCHA (Yandex SmartCaptcha).
- MVP: one Selectel cloud server (8 vCPU / 16 GB / NVMe) + Selectel S3 object storage,
  backups to a bucket in a different Selectel region.
- Scale: Yandex Cloud or Selectel managed PostgreSQL and Redis; decided when the scale
  triggers in `docs/architecture.md` fire.

| Option | Data in RF | Managed PG / Redis | Object storage | CDN | Ops burden |
| --- | --- | --- | --- | --- | --- |
| Selectel | Yes | Yes | Yes (S3) | Yes | Low–medium |
| Yandex Cloud | Yes | Yes | Yes (S3) | Yes | Low |
| VK Cloud | Yes | Yes | Yes (S3) | Yes | Low–medium |
| Self-managed VPS (any RF host) | Yes | No | Separate | Separate | High |

Prices were not checked for this draft; Kirill compares current tariffs before ordering.
Selectel is proposed for MVP because a single VM plus S3 is simple to start and easy to
move; Yandex Cloud is the likely scale target for its managed services. Both are
acceptable; the choice does not change the code.

## Consequences
- No foreign SaaS on the personal-data path (no hosted Sentry, Mailgun, Cloudflare proxy,
  Google Analytics). Residual cross-border flows (Web Push endpoints, optional Google
  login) are listed in the compliance checklist for the lawyer.
- Kirill must open the hosting account and register as a personal-data operator with
  Roskomnadzor before real users arrive.

## Alternatives considered
- EU or global cloud: violates localisation. Rejected.
