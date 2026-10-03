'use client';

import { MIN_SIGNUP_AGE, PASSWORD_MIN_LENGTH } from '@elega/shared/account-rules';
import { Button, Input } from '@elega/ui';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type FormErrors, toFormErrors } from '@/lib/errors';
import { useFragment } from '@/lib/fragment';
import { acceptAuthResult, api } from '@/lib/session';
import { OAuthButtons, useProviderName, usePublicConfig } from './oauth-buttons';
import { AuthShell, Checkbox, Divider, FormAlert, PasswordStrength } from './parts';

const empty: FormErrors = { fields: {}, form: null };

function latestAllowedBirthdate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - MIN_SIGNUP_AGE);
  return date.toISOString().slice(0, 10);
}

interface Pending {
  provider: 'vk' | 'yandex' | 'google';
  email: string | null;
  displayName: string | null;
  birthdate: string | null;
}

/** Sign-up with a password, or completion of a VK ID / Yandex ID sign-up (`mode="external"`). */
export function SignupForm({ mode }: { mode: 'password' | 'external' }) {
  const t = useTranslations();
  const locale = useLocale() as 'ru' | 'en';
  const router = useRouter();
  const config = usePublicConfig();
  const providerName = useProviderName();
  const fragment = useFragment();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<Pending | null>(null);
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    username: '',
    birthdate: '',
    // null until edited: shows the code from an invitation link (`#invite=` or `?invite=`).
    inviteCode: null as string | null,
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPd, setAcceptPd] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [busy, setBusy] = useState(false);
  const loaded = useRef<string | null>(null);

  const token = mode === 'external' ? (fragment?.get('token') ?? null) : null;
  const inviteCode = form.inviteCode ?? fragment?.get('invite') ?? searchParams.get('invite') ?? '';
  const tokenMissing = mode === 'external' && fragment !== null && !token;

  useEffect(() => {
    if (!token || loaded.current === token) return;
    loaded.current = token;
    void api()
      .POST('/auth/oauth/pending', { body: { token } })
      .then(({ data }) => {
        if (!data) {
          setErrors({ fields: {}, form: t('auth.errors.token_invalid') });
          return;
        }
        setPending(data);
        setForm((current) => ({
          ...current,
          displayName: data.displayName ?? current.displayName,
          birthdate: data.birthdate ?? current.birthdate,
        }));
      });
  }, [token, t]);

  const update =
    (field: Exclude<keyof typeof form, 'inviteCode'>) => (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    const local: Record<string, string> = {};
    if (!acceptTerms) local.acceptedTermsVersion = t('auth.errors.consent_required');
    if (!acceptPd) local.acceptedPdProcessingVersion = t('auth.errors.consent_required');
    if (!form.birthdate) local.birthdate = t('auth.errors.required');
    if (Object.keys(local).length > 0) {
      setErrors({ fields: local, form: null });
      return;
    }
    setBusy(true);
    setErrors(empty);
    const shared = {
      displayName: form.displayName,
      username: form.username.trim().toLowerCase(),
      birthdate: form.birthdate,
      locale,
      ...(inviteCode ? { inviteCode } : {}),
      acceptedTermsVersion: config.legalVersions.terms,
      acceptedPrivacyVersion: config.legalVersions.privacy,
      acceptedPdProcessingVersion: config.legalVersions.pdProcessing,
    };
    const result =
      mode === 'external'
        ? await api().POST('/auth/oauth/complete', {
            body: {
              ...shared,
              token: token ?? '',
              ...(pending?.email ? {} : { email: form.email }),
            },
          })
        : await api().POST('/auth/register', {
            body: { ...shared, email: form.email, password: form.password },
          });
    setBusy(false);
    if (!result.data) {
      setErrors(toFormErrors(t, result.error?.error, result.response.status));
      return;
    }
    acceptAuthResult(result.data);
    router.push('/');
  }

  const registration = config?.registration;
  if (registration === 'closed') {
    return (
      <AuthShell title={t('auth.signup.title')}>
        <FormAlert message={t('auth.errors.registration_closed')} />
      </AuthShell>
    );
  }

  const title = mode === 'external' ? t('auth.signup.completeTitle') : t('auth.signup.title');
  const lead =
    mode === 'external' && pending
      ? t('auth.signup.completeLead', { provider: providerName(pending.provider) })
      : t('auth.signup.lead');
  const consentError = errors.fields.acceptedTermsVersion ?? errors.fields.acceptedPrivacyVersion;

  return (
    <AuthShell title={title} lead={lead}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormAlert
          message={errors.form ?? (tokenMissing ? t('auth.errors.token_invalid') : null)}
        />
        {(mode === 'password' || (pending && !pending.email)) && (
          <Input
            label={t('auth.fields.email')}
            type="email"
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
            required
            error={errors.fields.email}
          />
        )}
        {mode === 'external' && pending?.email && (
          <p className="text-sm text-muted">
            {t('auth.signup.emailFromProvider', { email: pending.email })}
          </p>
        )}
        {mode === 'password' && (
          <div className="space-y-2">
            <Input
              label={t('auth.fields.password')}
              type="password"
              value={form.password}
              onChange={update('password')}
              autoComplete="new-password"
              hint={t('auth.signup.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              minLength={PASSWORD_MIN_LENGTH}
              required
              error={errors.fields.password}
            />
            <PasswordStrength
              password={form.password}
              inputs={[form.email, form.username, form.displayName]}
            />
          </div>
        )}
        <Input
          label={t('auth.fields.displayName')}
          value={form.displayName}
          onChange={update('displayName')}
          autoComplete="name"
          maxLength={64}
          required
          error={errors.fields.displayName}
        />
        <Input
          label={t('auth.fields.username')}
          value={form.username}
          onChange={update('username')}
          autoComplete="username"
          autoCapitalize="none"
          hint={t('auth.signup.usernameHint')}
          maxLength={30}
          required
          error={errors.fields.username}
        />
        <Input
          label={t('auth.fields.birthdate')}
          type="date"
          value={form.birthdate}
          onChange={update('birthdate')}
          max={latestAllowedBirthdate()}
          hint={t('auth.signup.birthdateHint', { age: MIN_SIGNUP_AGE })}
          required
          error={errors.fields.birthdate}
        />
        {registration === 'invite_only' && (
          <Input
            label={t('auth.fields.inviteCode')}
            value={inviteCode}
            onChange={(event) =>
              setForm((current) => ({ ...current, inviteCode: event.target.value }))
            }
            autoCapitalize="characters"
            hint={t('auth.signup.inviteHint')}
            required
            error={errors.fields.inviteCode}
          />
        )}
        <div className="space-y-1">
          <Checkbox
            name="terms"
            checked={acceptTerms}
            onChange={setAcceptTerms}
            error={consentError}
          >
            {t.rich('auth.signup.acceptTerms', {
              terms: (chunks) => (
                <Link
                  href="/legal/terms"
                  target="_blank"
                  className="font-medium text-primary underline"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/legal/privacy"
                  target="_blank"
                  className="font-medium text-primary underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </Checkbox>
          <Checkbox
            name="pd"
            checked={acceptPd}
            onChange={setAcceptPd}
            error={errors.fields.acceptedPdProcessingVersion}
          >
            {t.rich('auth.signup.acceptPd', {
              consent: (chunks) => (
                <Link
                  href="/legal/pd-processing"
                  target="_blank"
                  className="font-medium text-primary underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </Checkbox>
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={busy || !config}>
          {mode === 'external' ? t('auth.signup.complete') : t('common.signUp')}
        </Button>
      </form>
      {mode === 'password' && config && config.oauthProviders.length > 0 && (
        <>
          <Divider label={t('auth.or')} />
          <OAuthButtons providers={config.oauthProviders} />
        </>
      )}
      <p className="text-center text-sm text-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link
          href="/login"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('common.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
