import { createServer, type Server } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { Logger } from 'pino';
import { startEmailPipeline } from './email/email.js';
import type { Env } from './env.js';
import { HEARTBEAT_JOB, HEARTBEAT_KEY, heartbeatState, SYSTEM_QUEUE } from './heartbeat.js';

export interface RunningWorker {
  server: Server;
  close(): Promise<void>;
}

/**
 * Starts BullMQ consumers and a tiny health server. Module consumers (media, feed fan-out,
 * notifications) are registered here as their milestones land. The outbox relay and email
 * sender run from M1.
 */
export async function startWorker(env: Env, logger: Logger): Promise<RunningWorker> {
  const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  await redis.connect();

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 4,
    application_name: 'elega-worker',
  });
  const email = startEmailPipeline(env, pool, connection, logger);

  const queue = new Queue(SYSTEM_QUEUE, { connection });
  await queue.upsertJobScheduler(
    HEARTBEAT_JOB,
    { every: env.HEARTBEAT_EVERY_MS },
    { name: HEARTBEAT_JOB, opts: { removeOnComplete: 10, removeOnFail: 50 } },
  );

  const worker = new Worker(
    SYSTEM_QUEUE,
    async (job) => {
      if (job.name === HEARTBEAT_JOB) {
        await redis.set(HEARTBEAT_KEY, String(Date.now()));
        return;
      }
      throw new Error(`Unknown job ${job.name} on ${SYSTEM_QUEUE}`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id, job: job?.name }, 'job failed'),
  );
  worker.on('error', (err) => logger.error({ err }, 'worker error'));

  const server = createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let state: string;
      try {
        const last = await redis.get(HEARTBEAT_KEY);
        state = heartbeatState(
          last === null ? null : Number(last),
          Date.now(),
          env.HEARTBEAT_EVERY_MS,
        );
      } catch {
        state = 'redis_unavailable';
      }
      const ok = state === 'ok' && worker.isRunning();
      res
        .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ status: ok ? 'ok' : 'down', checks: { heartbeat: state } }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(env.HEALTH_PORT, resolve));
  logger.info({ port: env.HEALTH_PORT }, 'worker started');

  return {
    server,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await worker.close();
      await queue.close();
      await email.close();
      await pool.end();
      redis.disconnect();
    },
  };
}
