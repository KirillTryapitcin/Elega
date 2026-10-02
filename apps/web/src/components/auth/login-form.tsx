'use client';

import { Button, Input } from '@elega/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { type FormErrors, toFormErrors } from '@/lib/errors';
import { useFragment } from '@/lib/fragment';
import { acceptAuthResult, api } from '@/lib/session';
import { OAuthButtons, usePublicConfig } from './oauth-buttons';
import { AuthShell, Checkbox, Divider, FormAlert } from './parts';

const empty: FormErrors = { fields: {}, form: null };

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const config = usePublicConfig();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const fragment = useFragment();
  // undefined: take the challenge from the fragment; null: the user went back to the password form.
  const [challenge, setMfaToken] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // An OAuth sign-in lands here with `#mfa=` (2FA needed) or `#oauthError=`.
  const mfaToken = challenge === undefined ? (fragment?.get('mfa') ?? null) : challenge;
  const oauthError = submitted ? null : fragment?.get('oauthError');
  const oauthMessage = oauthError
    ? t.has(`auth.oauthErrors.${oauthError}`)
      ? t(`auth.oauthErrors.${oauthError}`)
      : t('auth.oauthErrors.provider_error')
    : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setBusy(true);
    setErrors(empty);
    const { data, error, response } = await api().POST('/auth/login', {
      body: { identifier, password, rememberDevice: remember },
    });
    setBusy(false);
    if (!data) {
      setErrors(
        response.status === 401
          ? { fields: {}, form: t('auth.errors.invalid_credentials') }
          : toFormErrors(t, error?.error, response.status),
      );
      return;
    }
    if ('mfaRequired' in data) {
      setMfaToken(data.mfaToken);
      return;
    }
    acceptAuthResult(data);
    router.push('/');
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!mfaToken) return;
    setSubmitted(true);
    setBusy(true);
    setErrors(empty);
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    const { data, error, response } = await api().POST('/auth/login/2fa', {
      body: { mfaToken, code: normalized },
    });
    setBusy(false);
    if (!data) {
      setErrors(
        response.status === 401
          ? { fields: { code: t('auth.errors.code_invalid') }, form: null }
          : toFormErrors(t, error?.error, response.status),
      );
      return;
    }
    acceptAuthResult(data);
    router.push('/');
  }

  if (mfaToken) {
    return (
      <AuthShell title={t('auth.mfa.title')} lead={t('auth.mfa.lead')}>
        <form className="space-y-4" onSubmit={submitCode} noValidate>
          <FormAlert message={errors.form} />
          <Input
            label={t('auth.mfa.code')}
            hint={t('auth.mfa.hint')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            maxLength={12}
            error={errors.fields.code}
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {t('auth.mfa.submit')}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMfaToken(null);
            setCode('');
            setErrors(empty);
          }}
          className="block w-full text-center text-sm font-medium text-primary"
        >
          {t('auth.backToSignIn')}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.login.title')}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormAlert message={errors.form ?? oauthMessage} />
        <Input
          label={t('auth.login.identifier')}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
          error={errors.fields.identifier}
        />
        <Input
          label={t('auth.fields.password')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          error={errors.fields.password}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Checkbox name="remember" checked={remember} onChange={setRemember}>
            {t('auth.login.remember')}
          </Checkbox>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.login.forgot')}
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {t('common.signIn')}
        </Button>
      </form>
      {config && config.oauthProviders.length > 0 && (
        <>
          <Divider label={t('auth.or')} />
          <OAuthButtons providers={config.oauthProviders} />
        </>
      )}
      <p className="text-center text-sm text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link
          href="/signup"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('common.signUp')}
        </Link>
      </p>
    </AuthShell>
  );
}
