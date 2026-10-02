import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.js';

const specPath = fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url));
const spec = parse(readFileSync(specPath, 'utf8')) as {
  components: { schemas: Record<string, { properties: Record<string, unknown> }> };
};

describe('shared schemas match the OpenAPI contract', () => {
  it('error codes', () => {
    const error = spec.components.schemas['Error']?.properties['error'] as {
      properties: { code: { enum: string[] } };
    };
    expect([...ERROR_CODES].sort()).toEqual([...error.properties.code.enum].sort());
  });

  it('health statuses', () => {
    const health = spec.components.schemas['Health']?.properties['status'] as { enum: string[] };
    expect(health.enum.sort()).toEqual(['degraded', 'down', 'ok']);
  });
});
