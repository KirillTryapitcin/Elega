import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { z } from 'zod';

export const EMAIL_TEMPLATES = [
  'verify_email',
  'change_email_confirm',
  'change_email_notice',
  'reset_password',
  'password_changed',
  'new_device_login',
  'two_factor_enabled',
  'two_factor_disabled',
  'provider_linked',
] as const;

/** The `email.requested` outbox payload written by apps/api/src/platform/outbox.ts. */
export const emailRequestSchema = z.object({
  template: z.enum(EMAIL_TEMPLATES),
  to: z.email(),
  locale: z.enum(['ru', 'en']),
  linkPath: z
    .string()
    .regex(/^\/[^/\\]/, 'must be a path on the web app')
    .optional(),
  params: z.record(z.string(), z.string()).optional(),
});
export type EmailRequest = z.infer<typeof emailRequestSchema>;

interface EmailCopy {
  greeting: string;
  footer: string;
  [template: string]: string | { subject: string; body: string; action: string };
}

function loadCopy(locale: 'ru' | 'en'): EmailCopy {
  const url = new URL(import.meta.resolve(`@elega/i18n/messages/${locale}.json`));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- locale is 'ru' | 'en'
  return (JSON.parse(readFileSync(url, 'utf8')) as { emails: EmailCopy }).emails;
}

const COPY = { ru: loadCopy('ru'), en: loadCopy('en') };

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  vk: 'VK ID',
  yandex: 'Яндекс ID',
  google: 'Google',
};

/** Plain text plus a minimal, inline-styled HTML part. Every parameter is escaped. */
export function renderEmail(request: EmailRequest, appBaseUrl: string): RenderedEmail {
  const copy = COPY[request.locale];
  const block = copy[request.template];
  if (typeof block !== 'object') throw new Error(`No copy for ${request.template}`);
  const params: Record<string, string> = { name: '', ...request.params };
  if (params.provider) params.provider = PROVIDER_NAMES[params.provider] ?? params.provider;
  if (params.time) {
    params.time = new Intl.DateTimeFormat(request.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Moscow',
    }).format(new Date(params.time));
  }
  const format = (message: string) =>
    String(new IntlMessageFormat(message, request.locale).format(params));
  const greeting = params.name ? format(copy.greeting) : '';
  const body = format(block.body);
  const link = request.linkPath ? `${appBaseUrl}${request.linkPath}` : null;

  const text = [greeting, body, link ? `${block.action}: ${link}` : '', '—', copy.footer]
    .filter(Boolean)
    .join('\n\n');
  const html = `<!doctype html><html lang="${request.locale}"><body style="margin:0;background:#f6f5fb;font-family:Arial,sans-serif;color:#1d1b2e">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:20px;font-weight:bold;color:#4338b8;margin:0 0 24px">Элега</p>
${greeting ? `<p style="font-size:16px;margin:0 0 12px">${escapeHtml(greeting)}</p>` : ''}
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>
${link ? `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#4338b8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-size:16px">${escapeHtml(block.action)}</a></p>` : ''}
<p style="font-size:13px;line-height:1.5;color:#5b5873;margin:0">${escapeHtml(copy.footer)}</p>
</div></body></html>`;
  return { subject: format(block.subject), text, html };
}
