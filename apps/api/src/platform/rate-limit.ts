import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Observable } from 'rxjs';
import { randomToken } from './crypto.js';
import { AppError } from './errors/app-error.js';
import { REDIS } from './redis.js';

export interface RateRule {
  limit: number;
  windowSec: number;
  /**
   * Who the counter belongs to when applied by the decorator. `user` falls back to the client IP
   * for anonymous callers (public routes), so it never leaves a route unlimited.
   */
  by: 'ip' | 'user';
}

/**
 * Limits per endpoint class (brief §20.2). Body-keyed limits (per email, per identifier) are
 * applied inside the services with the same limiter.
 */
export const RATE_RULES = {
  global: { limit: 600, windowSec: 60, by: 'ip' },
  'auth.register': { limit: 5, windowSec: 3600, by: 'ip' },
  'auth.register.email': { limit: 3, windowSec: 86_400, by: 'ip' },
  'auth.login': { limit: 30, windowSec: 900, by: 'ip' },
  // Failed logins per identifier: 5 in 15 min locks it briefly, 20 in a day locks it longer.
  'auth.login.failures': { limit: 5, windowSec: 900, by: 'ip' },
  'auth.login.failures.daily': { limit: 20, windowSec: 86_400, by: 'ip' },
  // Failed logins per IP across identifiers (credential stuffing).
  'auth.login.ip_failures': { limit: 50, windowSec: 3600, by: 'ip' },
  'auth.mfa': { limit: 10, windowSec: 900, by: 'ip' },
  'auth.refresh': { limit: 60, windowSec: 60, by: 'ip' },
  'auth.token': { limit: 20, windowSec: 3600, by: 'ip' },
  'auth.forgot': { limit: 5, windowSec: 3600, by: 'ip' },
  'auth.forgot.email': { limit: 3, windowSec: 3600, by: 'ip' },
  'auth.resend': { limit: 3, windowSec: 3600, by: 'user' },
  'auth.sensitive': { limit: 10, windowSec: 3600, by: 'user' },
  'auth.oauth': { limit: 30, windowSec: 600, by: 'ip' },
  'account.write': { limit: 60, windowSec: 3600, by: 'user' },
  'media.upload': { limit: 60, windowSec: 3600, by: 'user' },
  // Profile reads: per member when signed in (carrier NAT puts many members behind one IP),
  // per IP for anonymous visitors.
  'profile.read': { limit: 300, windowSec: 300, by: 'user' },
  // Username probes (a taken name answers 409): counted only on that outcome, so checking a
  // free name costs nothing. Logged as security events (brief §20.2).
  'account.username_taken': { limit: 10, windowSec: 86_400, by: 'user' },
  'auth.register.username_taken': { limit: 20, windowSec: 86_400, by: 'ip' },
} as const satisfies Record<string, RateRule>;

export type RateRuleName = keyof typeof RATE_RULES;

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window frees a slot (0 when allowed). */
  retryAfterSec: number;
  resetSec: number;
}

// Sliding-window log: one sorted-set member per hit, scored by time. Atomic in Redis.
// ARGV: now_ms, window_ms, limit, member, mode (consume | peek | add)
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = 0
if oldest[2] then reset = tonumber(oldest[2]) + window - now end
if ARGV[5] == 'peek' then
  if count >= limit then return {0, count, reset} end
  return {1, count, reset}
end
if ARGV[5] == 'consume' and count >= limit then return {0, count, reset} end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
if reset == 0 then reset = window end
return {1, count + 1, reset}
`;

@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts a hit if under the limit. */
  consume(rule: RateRuleName, subject: string): Promise<RateResult> {
    return this.run(rule, subject, 'consume');
  }

  /** Reports whether the subject is over the limit without counting. */
  peek(rule: RateRuleName, subject: string): Promise<RateResult> {
    return this.run(rule, subject, 'peek');
  }

  /** Counts a hit unconditionally (for example a failed login). */
  add(rule: RateRuleName, subject: string): Promise<RateResult> {
    return this.run(rule, subject, 'add');
  }

  async reset(rule: RateRuleName, subject: string): Promise<void> {
    await this.redis.del(this.key(rule, subject));
  }

  /** Throws 429 with Retry-After when over the limit. */
  async enforce(rule: RateRuleName, subject: string): Promise<RateResult> {
    const result = await this.consume(rule, subject);
    if (!result.allowed) throw rateLimited(result);
    return result;
  }

  private key(rule: string, subject: string): string {
    return `rl:${rule}:${subject}`;
  }

  private async run(
    rule: RateRuleName,
    subject: string,
    mode: 'consume' | 'peek' | 'add',
  ): Promise<RateResult> {
    const { limit, windowSec } = RATE_RULES[rule];
    const raw = (await this.redis.eval(
      SCRIPT,
      1,
      this.key(rule, subject),
      Date.now(),
      windowSec * 1000,
      limit,
      `${Date.now()}:${randomToken(6)}`,
      mode,
    )) as [number, number, number];
    const [allowed, count, resetMs] = raw;
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    return {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: allowed === 1 ? 0 : resetSec,
      resetSec,
    };
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly result: RateResult) {
    super('rate_limited', 'Too many requests');
  }
}

export function rateLimited(result: RateResult): RateLimitedError {
  return new RateLimitedError(result);
}

const RATE_LIMIT_KEY = 'elega:rateLimit';
const NO_RATE_LIMIT_KEY = 'elega:noRateLimit';
/** For liveness and readiness probes, which must answer even when Redis is down. */
export const NoRateLimit = () => SetMetadata(NO_RATE_LIMIT_KEY, true);
/** Applies a named rule to the route, keyed by client IP or by user per the rule. */
export const RateLimit = (rule: RateRuleName) => SetMetadata(RATE_LIMIT_KEY, rule);

/** The counter key of a decorator-applied rule: the user when signed in, else the client IP. */
export function rateSubject(
  rule: RateRule,
  request: Pick<FastifyRequest, 'authUser' | 'ip'>,
): string {
  return rule.by === 'user' && request.authUser ? request.authUser.id : request.ip;
}

export function setRateHeaders(reply: FastifyReply, result: RateResult): void {
  void reply.header('RateLimit-Limit', result.limit);
  void reply.header('RateLimit-Remaining', result.remaining);
  void reply.header('RateLimit-Reset', result.resetSec);
  if (!result.allowed) void reply.header('Retry-After', result.retryAfterSec);
}

/**
 * Applies the global per-IP limit to every request and the route's named rule on top. Runs
 * after the auth guard, so user-keyed rules see the caller.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(NO_RATE_LIMIT_KEY, targets)) {
      return next.handle();
    }

    // The global ceiling fails open if Redis is unreachable; named rules below fail closed.
    const global = await this.limiter.consume('global', request.ip).catch((error: unknown) => {
      this.logger.warn({ err: (error as Error).message }, 'Global rate limit unavailable');
      return null;
    });
    let shown = global;
    if (global && !global.allowed) {
      setRateHeaders(reply, global);
      throw rateLimited(global);
    }
    const ruleName = this.reflector.getAllAndOverride<RateRuleName | undefined>(
      RATE_LIMIT_KEY,
      targets,
    );
    if (ruleName) {
      const rule = RATE_RULES[ruleName];
      const subject = rateSubject(rule, request);
      const result = await this.limiter.consume(ruleName, subject);
      shown = result;
      if (!result.allowed) {
        setRateHeaders(reply, result);
        throw rateLimited(result);
      }
    }
    if (shown) setRateHeaders(reply, shown);
    return next.handle();
  }
}
