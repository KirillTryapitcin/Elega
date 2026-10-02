import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, ne, or, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { sessions } from '../../db/schema.js';
import { KEYRING, type Keyring, randomToken, sha256 } from '../../platform/crypto.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { DB, type Db, type Executor } from '../../platform/database.js';
import { audit } from '../../platform/outbox.js';
import { REDIS } from '../../platform/redis.js';
import { type ClientInfo, hashIp } from '../../platform/request-context.js';
import { deviceName } from '../../platform/user-agent.js';
import { ACCESS_TOKEN_TTL_SEC } from './access-tokens.js';

const DAY_MS = 86_400_000;
/** "Remember this device": 30 days, sliding (ADR-004). */
export const REMEMBERED_SESSION_MS = 30 * DAY_MS;
/** Otherwise the cookie dies with the browser and the server caps the session at 12 hours. */
export const BROWSER_SESSION_MS = 12 * 60 * 60 * 1000;
/**
 * Two tabs refreshing at the same moment present the same token twice. A repeat within this
 * window is refused without revoking the family; later repeats are treated as token theft.
 */
const REUSE_GRACE_MS = 5_000;
const NEW_DEVICE_LOOKBACK_MS = 90 * DAY_MS;
const SESSIONS_CURSOR_SCOPE = 'sessions';

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  remember: boolean;
  expiresAt: Date;
  /** True when this browser/OS pair has not been used on the account in the last 90 days. */
  newDevice: boolean;
}

export type RotateResult =
  | { ok: true; userId: string; session: IssuedSession }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' | 'race' };

export interface SessionView {
  id: string;
  deviceName?: string;
  userAgent?: string;
  coarseLocation: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
}

const deniedKey = (sessionId: string) => `auth:denied-sid:${sessionId}`;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYRING) private readonly keyring: Keyring,
  ) {}

  async create(
    db: Executor,
    userId: string,
    remember: boolean,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const device = deviceName(client.userAgent);
    const recent = await db
      .select({ deviceName: sessions.deviceName })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          gt(sessions.createdAt, new Date(Date.now() - NEW_DEVICE_LOOKBACK_MS)),
        ),
      )
      .limit(500);
    const newDevice = recent.length > 0 && !recent.some((row) => row.deviceName === device);

    const familyId = randomUUID();
    const refreshToken = randomToken();
    const expiresAt = new Date(
      Date.now() + (remember ? REMEMBERED_SESSION_MS : BROWSER_SESSION_MS),
    );
    const [row] = await db
      .insert(sessions)
      .values({
        userId,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        deviceName: device,
        userAgent: client.userAgent,
        ipHash: hashIp(this.keyring.pii, client.ip),
        rememberDevice: remember,
        expiresAt,
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error('session insert returned nothing');
    return { sessionId: row.id, familyId, refreshToken, remember, expiresAt, newDevice };
  }

  /** Rotates a refresh token (ADR-004). A replayed rotated token revokes the whole family. */
  async rotate(refreshToken: string, client: ClientInfo): Promise<RotateResult> {
    const result = await this.db.transaction(async (tx): Promise<RotateResult> => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, sha256(refreshToken)))
        .for('update');
      if (!row) return { ok: false, reason: 'unknown' };
      if (row.revokedAt) {
        const [child] = await tx
          .select({ createdAt: sessions.createdAt })
          .from(sessions)
          .where(eq(sessions.rotatedFromId, row.id));
        if (!child) return { ok: false, reason: 'unknown' }; // logged out, not rotated
        if (Date.now() - child.createdAt.getTime() < REUSE_GRACE_MS) {
          return { ok: false, reason: 'race' };
        }
        await this.revokeFamily(tx, row.familyId);
        await audit(tx, {
          actorId: row.userId,
          action: 'session.refresh_reuse_detected',
          entityType: 'session',
          entityId: row.id,
          ipHash: hashIp(this.keyring.pii, client.ip),
          userAgent: client.userAgent,
        });
        return { ok: false, reason: 'reused' };
      }
      if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

      const nextToken = randomToken();
      // Remembered sessions slide; browser sessions keep their 12-hour cap from sign-in.
      const expiresAt = row.rememberDevice
        ? new Date(Date.now() + REMEMBERED_SESSION_MS)
        : row.expiresAt;
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.id));
      const [next] = await tx
        .insert(sessions)
        .values({
          userId: row.userId,
          familyId: row.familyId,
          refreshTokenHash: sha256(nextToken),
          deviceName: deviceName(client.userAgent),
          userAgent: client.userAgent,
          ipHash: hashIp(this.keyring.pii, client.ip),
          coarseLocation: row.coarseLocation,
          rememberDevice: row.rememberDevice,
          expiresAt,
          rotatedFromId: row.id,
          // Keep the family's sign-in time so the session list shows when it started.
          createdAt: row.createdAt,
        })
        .returning({ id: sessions.id });
      if (!next) throw new Error('session insert returned nothing');
      return {
        ok: true,
        userId: row.userId,
        session: {
          sessionId: next.id,
          familyId: row.familyId,
          refreshToken: nextToken,
          remember: row.rememberDevice,
          expiresAt,
          newDevice: false,
        },
      };
    });
    if (!result.ok && result.reason === 'reused') {
      this.logger.warn({ event: 'refresh_reuse' }, 'Refresh token reuse detected; family revoked');
    }
    return result;
  }

  /** Logout of the session that owns this refresh token. Unknown tokens are ignored. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const [row] = await this.db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, sha256(refreshToken)));
    if (row) await this.revokeFamily(this.db, row.familyId);
  }

  async familyOf(
    sessionId: string,
    db: Executor = this.db,
  ): Promise<{ familyId: string; startedAt: Date } | null> {
    const [row] = await db
      .select({ familyId: sessions.familyId, createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    return row ? { familyId: row.familyId, startedAt: row.createdAt } : null;
  }

  /** Revokes one family and blocks its live access tokens. */
  async revokeFamily(db: Executor, familyId: string): Promise<void> {
    await this.revokeWhere(db, eq(sessions.familyId, familyId));
  }

  /** Revokes every session of the user, optionally keeping one family (the caller's). */
  async revokeAllForUser(db: Executor, userId: string, keepFamilyId?: string): Promise<void> {
    await this.revokeWhere(
      db,
      and(
        eq(sessions.userId, userId),
        keepFamilyId ? ne(sessions.familyId, keepFamilyId) : undefined,
      ),
    );
  }

  private async revokeWhere(db: Executor, scope: SQL | undefined): Promise<void> {
    // Rows still active, or rotated within the access-token lifetime, may back live tokens.
    const live = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          scope,
          or(
            isNull(sessions.revokedAt),
            gt(sessions.revokedAt, new Date(Date.now() - ACCESS_TOKEN_TTL_SEC * 1000)),
          ),
        ),
      );
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(scope, isNull(sessions.revokedAt)));
    await this.denyRecent(live.map((row) => row.id));
  }

  /** Access tokens are stateless; a revoked session's id is denied until its tokens expire. */
  async isDenied(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(deniedKey(sessionId))) === 1;
  }

  async list(
    userId: string,
    currentSessionId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: SessionView[]; page: { nextCursor: string | null; hasMore: boolean } }> {
    const after = cursor ? decodeCursor(this.keyring.cursor, SESSIONS_CURSOR_SCOPE, cursor) : null;
    const current = await this.familyOf(currentSessionId);
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          after?.id ? lt(sessions.id, after.id) : undefined,
        ),
      )
      .orderBy(desc(sessions.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.id,
        ...(row.deviceName ? { deviceName: row.deviceName } : {}),
        ...(row.userAgent ? { userAgent: row.userAgent } : {}),
        coarseLocation: row.coarseLocation,
        lastUsedAt: row.lastUsedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        current: row.familyId === current?.familyId,
      })),
      page: {
        nextCursor:
          hasMore && last
            ? encodeCursor(this.keyring.cursor, SESSIONS_CURSOR_SCOPE, { id: last.id })
            : null,
        hasMore,
      },
    };
  }

  /** Logs out one device. Returns false when the session is not the user's (404). */
  async revokeForUser(userId: string, sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    if (!row) return false;
    await this.revokeFamily(this.db, row.familyId);
    return true;
  }

  private async denyRecent(sessionIds: string[]): Promise<void> {
    const unique = [...new Set(sessionIds)];
    if (unique.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of unique) pipeline.set(deniedKey(id), '1', 'EX', ACCESS_TOKEN_TTL_SEC);
    await pipeline.exec();
  }
}
