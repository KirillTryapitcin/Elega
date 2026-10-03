import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { KEYRING, type Keyring } from '../../platform/crypto.js';
import type { AuthUser } from '../../platform/request-context.js';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const ISSUER = 'elega';
const AUDIENCE = 'elega-api';
// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

interface SigningKey {
  id: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/**
 * EdDSA (Ed25519) access tokens, ADR-004. Claims: sub, sid, role, minor, ev (email verified when
 * issued); kid in the header. Verifying an email changes nothing server-side: the client
 * refreshes to get a token with `ev: true`.
 */
@Injectable()
export class AccessTokens {
  private readonly keys: SigningKey[];

  constructor(@Inject(KEYRING) keyring: Keyring) {
    this.keys = keyring.jwt.map(({ id, seed }) => {
      const privateKey = createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
        format: 'der',
        type: 'pkcs8',
      });
      return { id, privateKey, publicKey: createPublicKey(privateKey) };
    });
  }

  async sign(user: AuthUser): Promise<string> {
    const [key] = this.keys;
    if (!key) throw new Error('No JWT signing key configured');
    return new SignJWT({
      sid: user.sessionId,
      role: user.role,
      minor: user.minor,
      ev: user.emailVerified,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.id, typ: 'at+jwt' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
      .sign(key.privateKey);
  }

  /** Returns the caller, or null for any invalid, expired or foreign token. */
  async verify(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = this.keys.find((candidate) => candidate.id === header.kid);
          if (!key) throw new errors.JWKSNoMatchingKey();
          return key.publicKey;
        },
        { algorithms: ['EdDSA'], issuer: ISSUER, audience: AUDIENCE, typ: 'at+jwt' },
      );
      const { sub, sid, role, minor, ev } = payload;
      // Every claim is required: a token without `ev` predates M2 and must be refreshed.
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof minor !== 'boolean' ||
        typeof ev !== 'boolean' ||
        (role !== 'user' && role !== 'moderator' && role !== 'analyst' && role !== 'admin')
      ) {
        return null;
      }
      return { id: sub, sessionId: sid, role, minor, emailVerified: ev };
    } catch {
      return null;
    }
  }
}
