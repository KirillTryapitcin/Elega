import { Injectable } from '@nestjs/common';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@elega/shared';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import argon2 from 'argon2';
import { AppError } from '../../platform/errors/app-error.js';

/**
 * argon2id parameters (brief §8.2): OWASP Password Storage Cheat Sheet's second option,
 * m = 19 MiB, t = 2, p = 1, about 40 ms on one core of the target VPS. Hashes carry their
 * parameters, so raising them later only needs `needsRehash` on the next login.
 * See docs/security.md, "Password hashing".
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** zxcvbn score below this is rejected: covers the common and breached password lists. */
export const MIN_PASSWORD_SCORE = 2;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...zxcvbnCommon.dictionary },
  graphs: zxcvbnCommon.adjacencyGraphs,
});

@Injectable()
export class Passwords {
  // A real hash of a random value: verifying against it when the account does not exist keeps
  // the response time the same, so timing does not reveal which emails are registered.
  private readonly dummyHash = argon2.hash(crypto.randomUUID(), ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /** Constant-time verification (argon2's own comparison). A null hash still costs the same. */
  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  /**
   * No composition rules (brief §8.2): length plus a guessability check against the offline
   * common-password dictionary, with the user's own name, email and username as inputs.
   */
  assertAcceptable(password: string, userInputs: string[], field = 'password'): void {
    const fail = (message: string) =>
      new AppError('validation_failed', 'Validation failed', [{ field, message }]);
    if (password.length < PASSWORD_MIN_LENGTH) throw fail('password_too_short');
    if (password.length > PASSWORD_MAX_LENGTH) throw fail('password_too_long');
    const inputs = userInputs
      .flatMap((input) => [input, ...input.split(/[@.\s_]+/)])
      .filter(Boolean);
    if (zxcvbn.check(password, inputs).score < MIN_PASSWORD_SCORE) throw fail('password_too_weak');
  }
}
