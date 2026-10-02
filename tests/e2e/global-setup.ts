import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Registration is invite-only, so the auth flow needs a code. It is created inside the running
 * Compose stack with the same CLI operators use in production, unless E2E_INVITE_CODE is set.
 */
export default function globalSetup(): void {
  if (process.env.E2E_INVITE_CODE) return;
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const output = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'api',
      'node',
      'dist/cli/invites.js',
      '--count',
      '1',
      '--max-uses',
      '20',
      '--expires-days',
      '1',
      '--note',
      'e2e',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const code = output.trim().split('\n').at(-1);
  if (!code) throw new Error('The invite CLI printed no code');
  process.env.E2E_INVITE_CODE = code;
}
