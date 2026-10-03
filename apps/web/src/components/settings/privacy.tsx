'use client';

import type { Schemas } from '@elega/api-client';
import { MINOR_SETTING_LIMITS } from '@elega/shared/account-rules';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Checkbox, FormAlert, Select } from '@/components/auth/parts';
import { useSession } from '@/components/session-provider';
import { toFormErrors } from '@/lib/errors';
import { api } from '@/lib/session';
import { Section } from './shell';

type Settings = Schemas['Settings'];
type ChoiceKey =
  | 'whoCanMessage'
  | 'whoCanSendFriendRequests'
  | 'whoCanSeeOnlineStatus'
  | 'whoCanMention'
  | 'defaultPostAudience'
  | 'feedMode';
type ToggleKey =
  | 'allowFollowers'
  | 'readReceiptsEnabled'
  | 'searchEngineIndexing'
  | 'discoverableByEmail'
  | 'dataSaver';

const CHOICES: Record<ChoiceKey, readonly string[]> = {
  whoCanMessage: ['everyone', 'friends', 'nobody'],
  whoCanSendFriendRequests: ['everyone', 'friends_of_friends', 'nobody'],
  whoCanSeeOnlineStatus: ['everyone', 'friends', 'nobody'],
  whoCanMention: ['everyone', 'friends', 'nobody'],
  defaultPostAudience: ['public', 'friends', 'close_friends', 'only_me'],
  feedMode: ['chronological', 'for_you'],
};

/** Values a minor may pick (brief §5: stricter defaults for 14–17). Undefined means no limit. */
function allowedForMinor(key: string): readonly unknown[] | undefined {
  return (MINOR_SETTING_LIMITS as Record<string, readonly unknown[]>)[key];
}

export function PrivacySettings() {
  const t = useTranslations();
  const { user } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api()
      .GET('/me/settings')
      .then(({ data, error: failure, response }) => {
        if (data) setSettings(data);
        else setError(toFormErrors(t, failure?.error, response.status).form);
      });
  }, [t]);

  if (!user) return null;
  if (!settings) {
    return error ? (
      <FormAlert message={error} />
    ) : (
      <p className="text-sm text-muted">{t('common.loading')}</p>
    );
  }

  const minor = user.isMinor;

  async function save(patch: Partial<Settings>) {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSaved(false);
    setError(null);
    const { data, error: failure, response } = await api().PATCH('/me/settings', { body: patch });
    if (data) {
      setSettings(data);
      setSaved(true);
    } else {
      setSettings(previous);
      setError(toFormErrors(t, failure?.error, response.status).form);
    }
  }

  function choice(key: ChoiceKey) {
    const limits = minor ? allowedForMinor(key) : undefined;
    const options = CHOICES[key].filter((value) => !limits || limits.includes(value));
    return (
      <Select
        label={t(`settings.privacy.${key}`)}
        value={String(settings![key] ?? options[0])}
        onChange={(value) => void save({ [key]: value } as Partial<Settings>)}
        options={options.map((value) => ({ value, label: t(`settings.privacy.options.${value}`) }))}
        {...(limits ? { hint: t('settings.privacy.minorLimited') } : {})}
      />
    );
  }

  function toggle(key: ToggleKey) {
    const limits = minor ? allowedForMinor(key) : undefined;
    const locked = Boolean(limits && !limits.includes(true));
    return (
      <div>
        <Checkbox
          name={key}
          checked={Boolean(settings![key])}
          disabled={locked}
          onChange={(checked) => void save({ [key]: checked } as Partial<Settings>)}
        >
          {t(`settings.privacy.${key}`)}
        </Checkbox>
        {locked && <p className="pl-8 text-xs text-muted">{t('settings.privacy.minorLocked')}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite">
        <FormAlert message={error} />
        {saved && <FormAlert tone="success" message={t('settings.saved')} />}
      </div>
      {minor && <FormAlert tone="success" message={t('settings.privacy.minorNotice')} />}
      <Section title={t('settings.privacy.contact')}>
        {choice('whoCanMessage')}
        {choice('whoCanSendFriendRequests')}
        {choice('whoCanMention')}
        {toggle('allowFollowers')}
      </Section>
      <Section title={t('settings.privacy.visibility')}>
        {choice('whoCanSeeOnlineStatus')}
        {choice('defaultPostAudience')}
        {toggle('readReceiptsEnabled')}
        {toggle('searchEngineIndexing')}
        {toggle('discoverableByEmail')}
      </Section>
      <Section title={t('settings.privacy.feed')}>
        {choice('feedMode')}
        {toggle('dataSaver')}
      </Section>
    </div>
  );
}
