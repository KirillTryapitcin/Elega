/** Redis key holding the epoch ms of the last processed heartbeat job. */
export const HEARTBEAT_KEY = 'worker:heartbeat:last';
export const SYSTEM_QUEUE = 'system';
export const HEARTBEAT_JOB = 'heartbeat';

export type HeartbeatState = 'ok' | 'stale' | 'missing';

/** A worker is healthy while the queue keeps delivering its own heartbeat job. */
export function heartbeatState(
  lastMs: number | null,
  nowMs: number,
  everyMs: number,
): HeartbeatState {
  if (lastMs === null) return 'missing';
  return nowMs - lastMs <= everyMs * 3 ? 'ok' : 'stale';
}
