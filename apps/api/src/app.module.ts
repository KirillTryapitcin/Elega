import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from './config/env.js';
import { AuthModule } from './modules/auth/index.js';
import { UsersModule } from './modules/users/index.js';
import { PlatformModule } from './platform/platform.module.js';
import { requestIdFor } from './platform/request-id.js';

const PROBES = new Set(['/api/v1/healthz', '/api/v1/readyz']);
const isProbe = (url: string) => PROBES.has(url.split('?')[0] ?? '');

@Module({
  imports: [
    PlatformModule,
    UsersModule,
    AuthModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req) => requestIdFor(req),
          // Never log credentials, tokens or cookies (brief §35.6).
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.token',
              '*.accessToken',
              '*.refreshToken',
              '*.newPassword',
              '*.currentPassword',
              '*.mfaToken',
              '*.code',
            ],
            censor: '[redacted]',
          },
          // Probes hit these every few seconds. Inside Nest middleware `req.url` is relative
          // to the mount point, so match on the original URL.
          autoLogging: {
            ignore: (req) =>
              isProbe((req as { originalUrl?: string }).originalUrl ?? req.url ?? ''),
          },
          // Log the path without the query string: tokens can travel in query parameters.
          serializers: {
            req: (req: { id: unknown; method: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: (req.url ?? '').split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
  ],
})
export class AppModule {}
