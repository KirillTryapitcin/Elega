import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Entry points client components may import; none may reach zod (web bundle budget). */
const CLIENT_ENTRIES = [
  'account-rules.ts',
  'countries.ts',
  'media.ts',
  'profiles.ts',
  'policy/index.ts',
];
const SRC = new URL('./', import.meta.url);
const IMPORT = /^(?:import|export)\s[^;]*?from\s+'([^']+)';/gms;

function importsOf(file: string): string[] {
  const source = readFileSync(new URL(file, SRC), 'utf8');
  return [...source.matchAll(IMPORT)].map((match) => match[1]!);
}

/** Every module reachable from `entry`, as paths relative to src. */
function reachable(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) {
        const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
        queue.push(
          new URL(specifier.replace(/\.js$/, '.ts'), new URL(base, 'file:///')).pathname.slice(1),
        );
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files: [...files], packages: [...packages] };
}

describe('client entry points', () => {
  it.each(CLIENT_ENTRIES)('%s imports no package (in particular not zod)', (entry) => {
    const { files, packages } = reachable(entry);
    expect(files.length).toBeGreaterThan(0);
    expect(packages).toEqual([]);
  });
});
