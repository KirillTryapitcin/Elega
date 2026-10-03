import { describe, expect, it } from 'vitest';
import { heartbeatState } from './heartbeat.js';

describe('heartbeatState', () => {
  it('is ok within three intervals and stale after', () => {
    expect(heartbeatState(1_000, 1_000 + 180_000, 60_000)).toBe('ok');
    expect(heartbeatState(1_000, 1_000 + 180_001, 60_000)).toBe('stale');
    expect(heartbeatState(null, 0, 60_000)).toBe('missing');
  });
});
