'use client';

import { Badge, Button, Input } from '@elega/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormAlert, Select } from '@/components/auth/parts';
import { useSession } from '@/components/session-provider';
import { type FormErrors, toFormErrors } from '@/lib/errors';
import { api, setUser } from '@/lib/session';
import { Section } from './shell';

const empty: FormErrors = { fields: {}, form: null };
const TIMEZONES = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/Minsk',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Yerevan',
  'Asia/Tbilisi',
  'Asia/Baku',
  'Asia/Bishkek',
  'Europe/Chisinau',
];

export function AccountSettings() {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useSession();
  const [form, setForm] = useState({
    displayName: user?.displayName ?? '',
    username: user?.username ?? '',
    locale: user?.locale ?? 'ru',
    timezone: user?.timezone ?? 'Europe/Moscow',
  });
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setErrors(empty);
    const patch = {
      ...(form.displayName !== user!.displayName ? { displayName: form.displayName } : {}),
      ...(form.username !== user!.username ? { username: form.username.trim().toLowerCase() } : {}),
      ...(form.locale !== user!.locale ? { locale: form.locale } : {}),
      ...(form.timezone !== user!.timezone ? { timezone: form.timezone } : {}),
    };
    const { data, error, response } = await api().PATCH('/me', { body: patch });
    setBusy(false);
    if (!data) {
      setErrors(toFormErrors(t, error?.error, response.status));
      return;
    }
    setUser(data);
    setSaved(true);
    if (patch.locale) {
      // The interface language follows the account language.
      document.cookie = `NEXT_LOCALE=${patch.locale}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }

  const zones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  return (
    <div className="space-y-6">
      <Section title={t('settings.account.profile')}>
        <form className="space-y-4" onSubmit={save} noValidate>
          <FormAlert message={errors.form} />
          {saved && <FormAlert tone="success" message={t('settings.saved')} />}
          <Input
            label={t('auth.fields.displayName')}
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            maxLength={64}
            error={errors.fields.displayName}
          />
          <Input
            label={t('auth.fields.username')}
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            autoCapitalize="none"
            hint={t('settings.account.usernameHint')}
            maxLength={30}
            error={errors.fields.username}
          />
          <Select
            label={t('common.language')}
            value={form.locale}
            onChange={(value) => setForm({ ...form, locale: value as 'ru' | 'en' })}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Select
            label={t('settings.account.timezone')}
            value={form.timezone}
            onChange={(value) => setForm({ ...form, timezone: value })}
            options={zones.map((zone) => ({ value: zone, label: zone.replace('_', ' ') }))}
          />
          <Button type="submit" disabled={busy}>
            {t('settings.save')}
          </Button>
        </form>
      </Section>
      <EmailSection />
    </div>
  );
}

function EmailSection() {
  const t = useTranslations();
  const { user } = useSession();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(empty);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function resend() {
    const { response } = await api().POST('/auth/resend-verification');
    setNotice(response.status === 202 ? t('settings.email.resent') : t('auth.errors.rate_limited'));
  }

  async function change(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors(empty);
    const { error, response } = await api().POST('/auth/change-email', {
      body: { currentPassword: password, newEmail },
    });
    setBusy(false);
    if (response.status !== 202) {
      setErrors(toFormErrors(t, error?.error, response.status));
      return;
    }
    setNotice(t('settings.email.changeSent', { email: newEmail }));
    setNewEmail('');
    setPassword('');
  }

  return (
    <Section title={t('settings.email.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{user.email}</span>
        {user.emailVerified ? (
          <Badge>{t('settings.email.verified')}</Badge>
        ) : (
          <Badge tone="accent">{t('settings.email.unverified')}</Badge>
        )}
      </div>
      {!user.emailVerified && (
        <Button variant="soft" size="sm" onClick={() => void resend()}>
          {t('settings.email.resend')}
        </Button>
      )}
      <FormAlert tone="success" message={notice} />
      {user.hasPassword ? (
        <form className="space-y-4" onSubmit={change} noValidate>
          <FormAlert message={errors.form} />
          <Input
            label={t('settings.email.new')}
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            autoComplete="email"
            error={errors.fields.newEmail}
          />
          <Input
            label={t('auth.fields.currentPassword')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            error={errors.fields.currentPassword}
          />
          <Button type="submit" variant="outline" disabled={busy || !newEmail || !password}>
            {t('settings.email.change')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">{t('settings.security.noPassword')}</p>
      )}
    </Section>
  );
}
