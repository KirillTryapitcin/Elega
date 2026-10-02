import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../env.js';
import { type EmailRequest, emailRequestSchema, renderEmail } from './render.js';

export const EMAIL_QUEUE = 'email';
const BATCH = 50;

type Connection = { url: string; maxRetriesPerRequest: null };

/**
 * Outbox relay (brief §6.5): moves `email.requested` events written in API transactions onto
 * the email queue, using the outbox id as the job id so a retried relay never double-sends.
 * The payload carries one-time links, so the row is redacted once the job is queued.
 */
export async function relayOutbox(pool: pg.Pool, queue: Queue): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; event_type: string; payload_json: unknown }>(
      `SELECT id, event_type, payload_json FROM outbox
       WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [BATCH],
    );
    for (const row of rows) {
      if (row.event_type === 'email.requested') {
        await queue.add('send', row.payload_json, {
          jobId: row.id,
          attempts: 6,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: { age: 24 * 3600 },
        });
      }
      await client.query(
        `UPDATE outbox SET published_at = now(), attempts = attempts + 1,
           payload_json = jsonb_build_object('redacted', true, 'template', payload_json->'template')
         WHERE id = $1`,
        [row.id],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface EmailPipeline {
  close(): Promise<void>;
}

export function startEmailPipeline(
  env: Env,
  pool: pg.Pool,
  connection: Connection,
  logger: Logger,
): EmailPipeline {
  const queue = new Queue(EMAIL_QUEUE, { connection });
  const transport = nodemailer.createTransport(env.SMTP_URL);

  const worker = new Worker(
    EMAIL_QUEUE,
    async (job) => {
      const request: EmailRequest = emailRequestSchema.parse(job.data);
      const email = renderEmail(request, env.APP_BASE_URL);
      await transport.sendMail({ from: env.MAIL_FROM, to: request.to, ...email });
      // Log the template only: addresses and links are personal data and secrets.
      logger.info({ jobId: job.id, template: request.template }, 'email sent');
    },
    { connection, concurrency: 4 },
  );
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'email failed'),
  );

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    try {
      // Drain in batches, then wait for the next poll.
      while (!stopped && (await relayOutbox(pool, queue)) === BATCH);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'outbox relay failed');
    }
    if (!stopped) timer = setTimeout(() => void tick(), env.OUTBOX_POLL_MS);
  };
  void tick();

  return {
    async close() {
      stopped = true;
      clearTimeout(timer);
      await worker.close();
      await queue.close();
      transport.close();
    },
  };
}
