import type { ApiError } from './session';

type Translate = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

export interface FormErrors {
  /** Field name → translated message. */
  fields: Record<string, string>;
  /** A message for the whole form, when no field fits. */
  form: string | null;
}

/**
 * Turns the unified API error body into messages. Detail messages are stable codes
 * (`username_taken`) translated under `auth.errors`; anything unknown falls back to the code.
 */
export function toFormErrors(
  t: Translate,
  error: ApiError | undefined,
  status?: number,
): FormErrors {
  if (!error) return { fields: {}, form: t('auth.errors.network') };
  const fields: Record<string, string> = {};
  for (const detail of error.details ?? []) {
    const key = `auth.errors.${detail.message}`;
    const message = t.has(key) ? t(key) : t('auth.errors.invalid');
    if (detail.field && !fields[detail.field]) fields[detail.field] = message;
  }
  if (Object.keys(fields).length > 0) return { fields, form: null };
  const codeKey = `auth.errors.${error.code}`;
  if (status === 429) return { fields, form: t('auth.errors.rate_limited') };
  return { fields, form: t.has(codeKey) ? t(codeKey) : t('errors.generic') };
}
