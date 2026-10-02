import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellDecision, POLICY_MATRIX, policyCell } from './matrix.js';

const doc = readFileSync(
  new URL('../../../../docs/authorization-matrix.md', import.meta.url),
  'utf8',
);

/** Parses every `## Title` section's table into header and rows. */
function documentTables(): Map<string, { header: string[]; rows: string[][] }> {
  const tables = new Map<string, { header: string[]; rows: string[][] }>();
  for (const section of doc.split(/^## /m).slice(1)) {
    const [title = '', ...rest] = section.split('\n');
    const lines = rest.filter((line) => line.startsWith('|'));
    if (lines.length < 3) continue;
    const split = (line: string) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
    tables.set(title.trim(), { header: split(lines[0]!), rows: lines.slice(2).map(split) });
  }
  return tables;
}

describe('policy matrix', () => {
  const tables = documentTables();

  it('mirrors every table in docs/authorization-matrix.md, cell for cell', () => {
    const policyTitles = new Set(POLICY_MATRIX.map((table) => table.title));
    const documented = [...tables.keys()].filter((title) => title !== 'Actors');
    expect([...policyTitles].sort()).toEqual(documented.sort());
    for (const table of POLICY_MATRIX) {
      const fromDoc = tables.get(table.title)!;
      expect([table.subject, ...table.actors], table.title).toEqual(fromDoc.header);
      expect(
        table.rows.map((row) => [row.action, ...row.cells]),
        table.title,
      ).toEqual(fromDoc.rows);
    }
  });

  it('documents every actor code used in the tables', () => {
    const actors = tables.get('Actors')!.rows.map((row) => row[0]!.replaceAll('`', ''));
    expect(actors).toEqual(
      expect.arrayContaining([
        'anon',
        'owner',
        'friend',
        'fof',
        'follower',
        'stranger',
        'blocked',
        'staff',
      ]),
    );
  });

  it('denies blocked viewers everything they could otherwise read or write', () => {
    for (const table of POLICY_MATRIX) {
      const column = table.actors.indexOf('blocked');
      if (column < 0) continue;
      for (const row of table.rows) {
        const cell = row.cells[column]!;
        // Reporting and blocking itself are the documented exceptions.
        if (row.action === 'Report' || row.action === 'Block / mute') continue;
        expect(['N', '—'], `${table.id} / ${row.action}`).toContain(cellDecision(cell));
      }
    }
  });

  it('never lets anyone impersonate a user', () => {
    const row = POLICY_MATRIX.find((table) => table.id === 'moderation')!.rows.find(
      (item) => item.action === 'Impersonate a user',
    )!;
    expect(row.cells.every((cell) => cell === 'N')).toBe(true);
  });

  it('looks cells up strictly', () => {
    expect(policyCell('profiles', 'Sessions, settings, export, delete', 'owner')).toBe('Y');
    expect(() => policyCell('profiles', 'Nope', 'owner')).toThrow();
    expect(cellDecision('A¹⁰')).toBe('A');
    expect(cellDecision('Remove only')).toBe('other');
  });
});
