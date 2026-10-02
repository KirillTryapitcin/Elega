import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import helmet from '@fastify/helmet';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { HttpErrorFilter } from './platform/errors/http-error.filter.js';
import { createValidationPipe } from './platform/errors/validation.js';
import { requestIdFor } from './platform/request-id.js';

export const API_PREFIX = 'api/v1';
const BODY_LIMIT_BYTES = 1024 * 1024;

/** Builds the configured application. Shared by `main.ts` and the integration tests. */
export async function createApp(): Promise<NestFastifyApplication> {
  const env = loadEnv();
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    // Trust only the configured number of proxy hops (Caddy) for the client IP.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    genReqId: (req: IncomingMessage) => requestIdFor(req),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  await app.register(helmet, {
    // JSON API: no HTML is ever served, so lock everything down.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  return app;
}

export type App = INestApplication;
