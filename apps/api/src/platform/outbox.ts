import type { Executor } from './database.js';
import { auditLog, outbox } from '../db/schema.js';

/**
 * Transactional emails the worker knows how to render. Parameters are interpolated into
 * escaped templates; links are built by the worker from APP_BASE_URL and the path given here.
 */
export type EmailTemplate =
  | 'verify_email'
  | 'change_email_confirm'
  | 'change_email_notice'
  | 'reset_password'
  | 'password_changed'
  | 'new_device_login'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'provider_linked';

export interface EmailRequest {
  template: EmailTemplate;
  to: string;
  locale: 'ru' | 'en';
  /** Path and fragment on the web app, e.g. `/verify-email#token=...`. */
  linkPath?: string;
  params?: Record<string, string>;
}

/**
 * Writes an event in the caller's transaction (brief §6.5); the worker relays it. The payload
 * may carry a one-time link, so the worker clears it once the email is handed to the queue.
 */
export async function enqueueEmail(
  db: Executor,
  userId: string,
  email: EmailRequest,
): Promise<void> {
  await db.insert(outbox).values({
    aggregateType: 'user',
    aggregateId: userId,
    eventType: 'email.requested',
    payloadJson: { ...email },
  });
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  after?: Record<string, unknown>;
  ipHash?: Buffer;
  userAgent?: string;
}

/** Security-relevant events (brief §20.6). Append-only table; never store secrets here. */
export async function audit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    afterJson: entry.after ?? null,
    ipHash: entry.ipHash ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
