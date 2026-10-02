# External sign-in providers

How VK ID, Yandex ID and Google sign-in work in Elega, what each provider returns, and what
an operator has to register. Decision record: [ADR-011](adr/011-login-providers.md).
Endpoint facts were taken from each provider's documentation on 2026-10-02; re-check them
when a provider changes its API.

## Flow (all providers)

1. `GET /api/v1/auth/oauth/{provider}/start?intent=login|link` creates a PKCE S256 pair and
   a random `state` (32+ characters), stores both in Redis for 10 minutes and sets the
   cookie `__Host-elega_oauth` = HMAC(state), which binds the flow to this browser. The
   response is a 302 to the provider.
2. The provider redirects to `{APP_BASE_URL}/api/v1/auth/oauth/{provider}/callback`. The API
   checks the state and the browser binding, exchanges the code with the PKCE verifier and
   reads the profile.
3. Known identity: the user is signed in (with a 2FA step when enabled, via `/login#mfa=`).
   New identity: the profile is parked in Redis for 30 minutes and the browser goes to
   `/signup/complete#token=…`, where the user picks a username and confirms birthdate and
   consents. Nothing is created before that.
4. Errors land on `/login#oauthError=<code>` (`invalid_state`, `expired`, `cancelled`,
   `provider_error`, `account_exists`, `account_banned`, `account_suspended`,
   `signin_required`).

Linking (`intent=link`) identifies the signed-in user from the refresh cookie (read, not
rotated) and returns to `/settings/security#linked=<provider>` or `#linkError=<code>`
(`already_linked`, `provider_already_linked`).

An external identity is never attached to an existing account because the email matches:
the user gets `account_exists` and links the provider from settings after signing in with a
password. Emails from VK ID and Yandex ID are treated as unverified (neither documents a
verification flag), so those accounts receive the usual verification email.

## VK ID

| | |
| --- | --- |
| Docs | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description |
| Authorize | `GET https://id.vk.ru/authorize`, `scope=vkid.personal_info email`, `lang_id=0` |
| Token | `POST https://id.vk.ru/oauth2/auth` with `code_verifier`, `device_id` (from the callback), `redirect_uri`, `client_id`; no client secret |
| Profile | `POST https://id.vk.ru/oauth2/user_info` → `user.user_id`, names, `email`, `birthday` |
| Env | `VK_CLIENT_ID` |

`verified` in the VK profile is the blue check, not email ownership. The birthday format is
not documented; `DD.MM.YYYY` and ISO dates are accepted, anything else is ignored and the
user enters it.

Register: create an app in the VK ID business account (id.vk.ru), platform Web, trusted
redirect URL `https://<domain>/api/v1/auth/oauth/vk/callback`, base domain `<domain>`.

## Yandex ID

| | |
| --- | --- |
| Docs | https://yandex.ru/dev/id/doc/ru/codes/code-url, https://yandex.ru/dev/id/doc/ru/user-information |
| Authorize | `GET https://oauth.yandex.ru/authorize`, no `scope` (rights come from the app settings) |
| Token | `POST https://oauth.yandex.ru/token` with `code_verifier`, `client_id`, `client_secret` when set |
| Profile | `GET https://login.yandex.ru/info?format=json`, header `Authorization: OAuth <token>` → `id`, names, `default_email`, `birthday` |
| Env | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` |

The birthday comes as `YYYY-MM-DD` with unknown parts as zeros (`0000-03-12`); partial dates
are ignored.

Register: create an app at https://oauth.yandex.ru, platform "Web services", Redirect URI
`https://<domain>/api/v1/auth/oauth/yandex/callback`, rights: login:info, login:email,
login:birthday (if offered), login:avatar.

## Google

Off by default. It appears only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
**and** the feature flag `auth.google` is on, because enabling it is a cross-border transfer
of personal data that needs legal review first (ADR-011).

| | |
| --- | --- |
| Docs | https://developers.google.com/identity/openid-connect/openid-connect |
| Authorize | `https://accounts.google.com/o/oauth2/v2/auth`, `scope=openid email profile` |
| Token | `https://oauth2.googleapis.com/token` |
| Profile | `https://openidconnect.googleapis.com/v1/userinfo`; `email_verified` is honoured |

## Local development

Real provider apps cannot redirect to `localhost` for VK ID, so the providers are off in
the Compose stack unless you set the variables yourself. The integration tests run the whole
flow against a fake provider (`apps/api/test/harness.ts`).
