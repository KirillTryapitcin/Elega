'use client';

import { Card } from '@elega/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';

/** Centered card used by every sign-in, sign-up and recovery page. */
export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-2xl font-bold tracking-tight text-primary">
        {t('appName')}
      </Link>
      <Card className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {lead && <p className="text-sm text-muted">{lead}</p>}
        </div>
        {children}
      </Card>
    </main>
  );
}

export function FormAlert({
  message,
  tone = 'danger',
}: {
  message: string | null;
  tone?: 'danger' | 'success';
}) {
  if (!message) return null;
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={
        tone === 'danger'
          ? 'rounded-control border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-ink'
          : 'rounded-control border border-primary/30 bg-primary-soft px-3.5 py-2.5 text-sm text-primary-ink'
      }
    >
      {message}
    </p>
  );
}

export function Checkbox({
  name,
  checked,
  onChange,
  children,
  error,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-ink"
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]"
        />
        <span>{children}</span>
      </label>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-control border border-border bg-surface px-3 text-base text-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Strength meter (brief §8.2). The dictionary loads lazily so it does not weigh on first paint. */
export function PasswordStrength({ password, inputs }: { password: string; inputs: string[] }) {
  const t = useTranslations('auth.strength');
  const [score, setScore] = useState<number | null>(null);
  const key = inputs.join('|');
  useEffect(() => {
    let cancelled = false;
    if (!password) return;
    void import('@/lib/strength').then(({ strength }) =>
      strength(password, key.split('|')).then((value) => {
        if (!cancelled) setScore(value);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [password, key]);
  if (!password || score === null) return null;
  const labels = ['weak', 'weak', 'fair', 'good', 'strong'] as const;
  const label = labels[score] ?? 'weak';
  const colors = ['bg-danger', 'bg-danger', 'bg-accent', 'bg-primary', 'bg-primary'];
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${index < Math.max(score, 1) ? colors[score] : 'bg-border'}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted">{t(label)}</p>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
