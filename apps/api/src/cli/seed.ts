/**
 * Deterministic local demo data: a few Russian-speaking accounts (one of them 15 years old,
 * to show the stricter defaults) and reusable invite codes. Refuses to run outside APP_ENV
 * local or test, because the demo password is public.
 *
 *   pnpm seed                                # against .env
 *   docker compose exec api node dist/cli/seed.js
 */
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { ENV, type Env, loadEnv } from '../config/env.js';
import { users } from '../db/schema.js';
import { AccountsService } from '../modules/auth/accounts.service.js';
import { Invites } from '../modules/auth/invites.js';
import { Passwords } from '../modules/auth/passwords.js';
import { SessionsService } from '../modules/auth/sessions.service.js';
import { DB, type Db } from '../platform/database.js';
import { assertSeedAllowed } from './guard.js';

assertSeedAllowed(loadEnv());

/** Public on purpose: it only ever exists in local and test databases. */
const DEMO_PASSWORD = 'elega-demo-password';

function yearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

const DEMO_USERS = [
  {
    username: 'anna.smirnova',
    displayName: 'Анна Смирнова',
    birthdate: '1994-03-12',
    locale: 'ru',
  },
  { username: 'ivan.petrov', displayName: 'Иван Петров', birthdate: '1988-11-02', locale: 'ru' },
  {
    username: 'olga.kuznetsova',
    displayName: 'Ольга Кузнецова',
    birthdate: '1979-07-21',
    locale: 'ru',
  },
  {
    username: 'dmitry.volkov',
    displayName: 'Дмитрий Волков',
    birthdate: '2001-01-30',
    locale: 'ru',
  },
  // Always 15, so the under-18 defaults stay visible in the demo.
  {
    username: 'masha.sokolova',
    displayName: 'Маша Соколова',
    birthdate: yearsAgo(15),
    locale: 'ru',
  },
  { username: 'john.miller', displayName: 'John Miller', birthdate: '1990-06-15', locale: 'en' },
] as const;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const db = app.get<Db>(DB, { strict: false });
  const env = app.get<Env>(ENV, { strict: false });
  const accounts = app.get(AccountsService, { strict: false });
  const invites = app.get(Invites, { strict: false });
  const passwords = app.get(Passwords, { strict: false });
  const sessions = app.get(SessionsService, { strict: false });
  const legal = accounts.legalVersions;
  const passwordHash = await passwords.hash(DEMO_PASSWORD);

  for (const demo of DEMO_USERS) {
    const email = `${demo.username.replace('.', '_')}@demo.elega.local`;
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      console.log(`[seed] exists: ${demo.username}`);
      continue;
    }
    const created = await accounts.create(
      {
        email,
        emailVerified: true,
        passwordHash,
        displayName: demo.displayName,
        username: demo.username,
        birthdate: demo.birthdate,
        locale: demo.locale,
        ...(env.REGISTRATION_MODE === 'invite_only'
          ? { inviteCode: await invites.create(db, { note: 'seed' }) }
          : {}),
        acceptedTermsVersion: legal.terms,
        acceptedPrivacyVersion: legal.privacy,
        acceptedPdProcessingVersion: legal.pdProcessing,
      },
      { ip: '127.0.0.1', userAgent: 'elega-seed' },
    );
    // Sign-up opens a session; the seed has no device to keep it on.
    await sessions.revokeAllForUser(db, created.user.id);
    console.log(`[seed] created: ${demo.username} <${email}>`);
  }

  const codes = await Promise.all(
    [1, 2, 3].map(() => invites.create(db, { maxUses: 20, note: 'seed: local sign-ups' })),
  );
  console.log(`[seed] demo password for every account: ${DEMO_PASSWORD}`);
  console.log(`[seed] invite codes (20 uses each): ${codes.join(', ')}`);
} finally {
  await app.close();
}
