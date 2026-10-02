'use client';

import type { Schemas } from '@elega/api-client';
import { Badge, Button, Input } from '@elega/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { OAuthButtons, useProviderName, usePublicConfig } from '@/components/auth/oauth-buttons';
import { FormAlert, PasswordStrength } from '@/components/auth/parts';
import { useSession } from '@/components/session-provider';
import { type FormErrors, toFormErrors } from '@/lib/errors';
import { useFragment } from '@/lib/fragment';
import { api, clearSession, refreshSession } from '@/lib/session';
import { Section } from './shell';

const empty: FormErrors = { fields: {}, form: null };

export function SecuritySettings() {
  const t = useTranslations();
  const providerName = useProviderName();
  // Linking VK ID / Yandex ID returns here with `#linked=` or `#linkError=`.
  const fragment = useFragment();
  const linked = fragment?.get('linked');
  const linkError = fragment?.get('linkError');
  const notice = linked ? t('settings.providers.linked', { provider: providerName(linked) }) : null;
  const problem = linkError
    ? t.has(`auth.oauthErrors.${linkError}`)
      ? t(`auth.oauthErrors.${linkError}`)
      : t('auth.oauthErrors.provider_error')
    : null;

  return (
    <div className="space-y-6">
      <FormAlert tone="success" message={notice} />
      <FormAlert message={problem} />
      <PasswordSection />
      <TwoFactorSection />
      <SessionsSection />
      <ProvidersSection />
    </div>
  );
}

function PasswordSection() {
  const t = useTranslations();
  const { user } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors(empty);
    setDone(false);
    const { error, response } = await api().POST('/auth/change-password', {
      body: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (response.status !== 204) {
      setErrors(toFormErrors(t, error?.error, response.status));
      return;
    }
    setDone(true);
    setCurrent('');
    setNext('');
  }

  return (
    <Section title={t('settings.security.password')}>
      {user?.hasPassword ? (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <FormAlert message={errors.form} />
          {done && <FormAlert tone="success" message={t('settings.security.passwordChanged')} />}
          <Input
            label={t('auth.fields.currentPassword')}
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            error={errors.fields.currentPassword}
          />
          <div className="space-y-2">
            <Input
              label={t('auth.fields.newPassword')}
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              error={errors.fields.newPassword}
            />
            <PasswordStrength
              password={next}
              inputs={[user.email, user.username, user.displayName]}
            />
          </div>
          <Button type="submit" disabled={busy || !current || !next}>
            {t('settings.security.changePassword')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">{t('settings.security.noPassword')}</p>
      )}
    </Section>
  );
}

/** Password (or a recent sign-in) plus a code when 2FA is on, for sensitive actions. */
function ConfirmFields({
  password,
  setPassword,
  code,
  setCode,
  errors,
}: {
  password: string;
  setPassword: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  errors: FormErrors;
}) {
  const t = useTranslations();
  const { user } = useSession();
  return (
    <>
      {user?.hasPassword && (
        <Input
          label={t('auth.fields.currentPassword')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          error={errors.fields.password}
        />
      )}
      {user?.twoFactorEnabled && (
        <Input
          label={t('auth.mfa.code')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          error={errors.fields.code}
        />
      )}
    </>
  );
}

function TwoFactorSection() {
  const t = useTranslations();
  const { user } = useSession();
  const [step, setStep] = useState<'idle' | 'confirm-password' | 'scan' | 'codes' | 'disable'>(
    'idle',
  );
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Schemas['TotpSetup'] | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const isStaff = user.role !== 'user';

  const confirmBody = () => ({
    ...(password ? { password } : {}),
    ...(code ? { code: code.replace(/[\s-]/g, '').toUpperCase() } : {}),
  });

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors(empty);
    const { data, error, response } = await api().POST('/auth/2fa/setup', { body: confirmBody() });
    setBusy(false);
    if (!data) return setErrors(toFormErrors(t, error?.error, response.status));
    setSetup(data);
    setPassword('');
    setCode('');
    setStep('scan');
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors(empty);
    const { data, error, response } = await api().POST('/auth/2fa/confirm', { body: { code } });
    setBusy(false);
    if (!data) return setErrors(toFormErrors(t, error?.error, response.status));
    setRecoveryCodes(data.recoveryCodes);
    setCode('');
    setStep('codes');
    await refreshSession();
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors(empty);
    const { error, response } = await api().POST('/auth/2fa/disable', { body: confirmBody() });
    setBusy(false);
    if (response.status !== 204) return setErrors(toFormErrors(t, error?.error, response.status));
    setPassword('');
    setCode('');
    setStep('idle');
    await refreshSession();
  }

  return (
    <Section
      title={t('settings.twoFactor.title')}
      description={t('settings.twoFactor.description')}
    >
      <div className="flex items-center gap-2">
        {user.twoFactorEnabled ? (
          <Badge>{t('settings.twoFactor.on')}</Badge>
        ) : (
          <Badge tone="accent">{t('settings.twoFactor.off')}</Badge>
        )}
        {isStaff && !user.twoFactorEnabled && (
          <span className="text-sm text-danger">{t('settings.twoFactor.staffRequired')}</span>
        )}
      </div>
      <FormAlert message={errors.form} />

      {step === 'idle' && !user.twoFactorEnabled && (
        <Button onClick={() => setStep('confirm-password')}>
          {t('settings.twoFactor.enable')}
        </Button>
      )}
      {step === 'idle' && user.twoFactorEnabled && !isStaff && (
        <Button variant="outline" onClick={() => setStep('disable')}>
          {t('settings.twoFactor.disable')}
        </Button>
      )}

      {step === 'confirm-password' && (
        <form className="space-y-4" onSubmit={start} noValidate>
          <p className="text-sm text-muted">{t('settings.reauth')}</p>
          <ConfirmFields
            password={password}
            setPassword={setPassword}
            code={code}
            setCode={setCode}
            errors={errors}
          />
          <Button type="submit" disabled={busy}>
            {t('settings.continue')}
          </Button>
        </form>
      )}

      {step === 'scan' && setup && (
        <form className="space-y-4" onSubmit={confirm} noValidate>
          <p className="text-sm text-ink">{t('settings.twoFactor.scan')}</p>
          {/* Rendered as an image, so the SVG can never run script in this page. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
            alt={t('settings.twoFactor.qrAlt')}
            width={200}
            height={200}
            className="rounded-control border border-border bg-white p-2"
          />
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">{t('settings.twoFactor.manual')}</summary>
            <code className="mt-2 block break-all rounded-control bg-bg p-2 text-xs text-ink">
              {new URL(setup.otpauthUrl).searchParams.get('secret')}
            </code>
          </details>
          <Input
            label={t('auth.mfa.code')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={errors.fields.code}
          />
          <Button type="submit" disabled={busy || code.length !== 6}>
            {t('settings.twoFactor.confirm')}
          </Button>
        </form>
      )}

      {step === 'codes' && (
        <div className="space-y-3">
          <FormAlert tone="success" message={t('settings.twoFactor.enabled')} />
          <p className="text-sm text-ink">{t('settings.twoFactor.recovery')}</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {recoveryCodes.map((value) => (
              <li key={value} className="rounded-control bg-bg px-3 py-2 text-ink">
                {value}
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setStep('idle')}>
            {t('settings.twoFactor.saved')}
          </Button>
        </div>
      )}

      {step === 'disable' && (
        <form className="space-y-4" onSubmit={disable} noValidate>
          <p className="text-sm text-muted">{t('settings.reauth')}</p>
          <ConfirmFields
            password={password}
            setPassword={setPassword}
            code={code}
            setCode={setCode}
            errors={errors}
          />
          <Button type="submit" variant="danger" disabled={busy}>
            {t('settings.twoFactor.disable')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function SessionsSection() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [sessions, setSessions] = useState<Schemas['Session'][] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FormErrors>(empty);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void api()
      .GET('/auth/sessions', { params: { query: { limit: 50 } } })
      .then(({ data }) => current && setSessions(data?.data ?? []));
    return () => {
      current = false;
    };
  }, [version]);

  async function revoke(id: string) {
    await api().DELETE('/auth/sessions/{id}', { params: { path: { id } } });
    setVersion((value) => value + 1);
  }

  async function revokeAll(event: FormEvent) {
    event.preventDefault();
    const { error, response } = await api().POST('/auth/logout-all', {
      body: { ...(password ? { password } : {}), ...(code ? { code } : {}) },
    });
    if (response.status !== 204) return setErrors(toFormErrors(t, error?.error, response.status));
    clearSession();
    router.replace('/login');
  }

  return (
    <Section title={t('settings.sessions.title')} description={t('settings.sessions.description')}>
      {sessions === null ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="space-y-0.5">
                <p className="font-medium text-ink">
                  {session.deviceName ?? t('settings.sessions.unknownDevice')}{' '}
                  {session.current && <Badge>{t('settings.sessions.current')}</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {t('settings.sessions.lastActive', {
                    time: format.relativeTime(new Date(session.lastUsedAt)),
                  })}
                  {session.coarseLocation ? ` · ${session.coarseLocation}` : ''}
                </p>
              </div>
              {!session.current && (
                <Button variant="ghost" size="sm" onClick={() => void revoke(session.id)}>
                  {t('settings.sessions.signOut')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!confirming ? (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          {t('settings.sessions.signOutAll')}
        </Button>
      ) : (
        <form className="space-y-4" onSubmit={revokeAll} noValidate>
          <FormAlert message={errors.form} />
          <ConfirmFields
            password={password}
            setPassword={setPassword}
            code={code}
            setCode={setCode}
            errors={errors}
          />
          <Button type="submit" variant="danger">
            {t('settings.sessions.signOutAll')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function ProvidersSection() {
  const t = useTranslations();
  const providerName = useProviderName();
  const config = usePublicConfig();
  const [linked, setLinked] = useState<Schemas['LinkedProvider'][] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void api()
      .GET('/auth/providers')
      .then(({ data }) => current && setLinked(data?.data ?? []));
    return () => {
      current = false;
    };
  }, [version]);

  async function unlink(provider: 'vk' | 'yandex' | 'google') {
    setProblem(null);
    const { response } = await api().DELETE('/auth/providers/{provider}', {
      params: { path: { provider } },
    });
    if (response.status === 409) setProblem(t('settings.providers.lastMethod'));
    setVersion((value) => value + 1);
  }

  const available = (config?.oauthProviders ?? []).filter(
    (provider) => !linked?.some((item) => item.provider === provider),
  );
  return (
    <Section
      title={t('settings.providers.title')}
      description={t('settings.providers.description')}
    >
      <FormAlert message={problem} />
      {linked?.map((item) => (
        <div key={item.provider} className="flex items-center justify-between gap-3">
          <span className="font-medium text-ink">{providerName(item.provider)}</span>
          <Button variant="ghost" size="sm" onClick={() => void unlink(item.provider)}>
            {t('settings.providers.unlink')}
          </Button>
        </div>
      ))}
      {available.length > 0 && <OAuthButtons providers={available} intent="link" />}
      {linked?.length === 0 && available.length === 0 && (
        <p className="text-sm text-muted">{t('settings.providers.none')}</p>
      )}
    </Section>
  );
}
