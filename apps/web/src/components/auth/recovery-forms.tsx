'use client';

import { PASSWORD_MIN_LENGTH } from '@elega/shared';
import { Button, buttonVariants, Input } from '@elega/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type FormErrors, toFormErrors } from '@/lib/errors';
import { useFragment } from '@/lib/fragment';
import { api, refreshSession, sessionStore, setUser } from '@/lib/session';
import { AuthShell, FormAlert, PasswordStrength } from './parts';

const empty: FormErrors = { fields: {}, form: null };

export function VerifyEmail() {
  const t = useTranslations();
  const fragment = useFragment();
  const token = fragment?.get('token');
  const [result, setResult] = useState<'done' | 'failed' | null>(null);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    // Tokens are single-use: never send the same one twice (Strict Mode runs effects twice).
    if (!token || sent.current === token) return;
    sent.current = token;
    void api()
      .POST('/auth/verify-email', { body: { token } })
      .then(async ({ data }) => {
        setResult(data ? 'done' : 'failed');
        if (!data) return;
        // Signed in on this device: refresh the cached account so the banner goes away. The
        // session may still be restoring; wait for it rather than read a stale account.
        const status = sessionStore.get().status;
        const signedIn =
          status === 'authenticated' || (status === 'loading' && (await refreshSession()));
        if (!signedIn) return;
        const me = await api().GET('/me');
        if (me.data) setUser(me.data);
      });
  }, [token]);
  const state = fragment === null ? 'working' : !token ? 'failed' : (result ?? 'working');
  return (
    <AuthShell title={t('auth.verify.title')}>
      {state === 'working' && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {state === 'done' && <FormAlert tone="success" message={t('auth.verify.done')} />}
      {state === 'failed' && <FormAlert message={t('auth.errors.token_invalid')} />}
      {state !== 'working' && (
        <Link href="/" className={buttonVariants({ className: 'w-full' })}>
          {t('auth.verify.continue')}
        </Link>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error, response } = await api().POST('/auth/forgot-password', { body: { email } });
    setBusy(false);
    if (response.status === 202) setSent(true);
    else setErrors(toFormErrors(t, error?.error, response.status));
  }

  return (
    <AuthShell title={t('auth.forgot.title')} lead={t('auth.forgot.lead')}>
      {sent ? (
        <FormAlert tone="success" message={t('auth.forgot.sent')} />
      ) : (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <FormAlert message={errors.form} />
          <Input
            label={t('auth.fields.email')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            error={errors.fields.email}
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-center text-sm font-medium text-primary">
        {t('auth.backToSignIn')}
      </Link>
    </AuthShell>
  );
}

export function ResetPassword() {
  const t = useTranslations();
  const fragment = useFragment();
  const token = fragment?.get('token');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setErrors({ fields: {}, form: t('auth.errors.token_invalid') });
      return;
    }
    setBusy(true);
    const { error, response } = await api().POST('/auth/reset-password', {
      body: { token, newPassword: password },
    });
    setBusy(false);
    if (response.status === 204) setDone(true);
    else setErrors(toFormErrors(t, error?.error, response.status));
  }

  return (
    <AuthShell title={t('auth.reset.title')} lead={done ? undefined : t('auth.reset.lead')}>
      {done ? (
        <>
          <FormAlert tone="success" message={t('auth.reset.done')} />
          <Link href="/login" className={buttonVariants({ className: 'w-full' })}>
            {t('common.signIn')}
          </Link>
        </>
      ) : (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <FormAlert message={errors.form ?? errors.fields.token ?? null} />
          <div className="space-y-2">
            <Input
              label={t('auth.fields.newPassword')}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              hint={t('auth.signup.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              required
              error={errors.fields.newPassword}
            />
            <PasswordStrength password={password} inputs={[]} />
          </div>
          <Button type="submit" className="w-full" disabled={busy || fragment === null}>
            {t('auth.reset.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
