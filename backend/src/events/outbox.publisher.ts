import type { Pool } from 'pg';
import type { Config } from '../config/env';
import { withTx } from '../db/pool';
import type { Logger } from '../observability/logger';

const MAX_ATTEMPTS = 10;

// Polls the outbox and delivers events at-least-once (consumers must be idempotent on eventId).
// Rows are claimed with FOR UPDATE SKIP LOCKED so several replicas can run it safely.
export function startOutboxPublisher(pool: Pool, cfg: Config, log: Logger) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function deliver(event: { event_id: string; payload: object }) {
    if (!cfg.PUBLISHING_EVENT_SINK_URL) {
      log.debug({ eventId: event.event_id }, 'no event sink configured; marking delivered');
      return;
    }
    const res = await fetch(cfg.PUBLISHING_EVENT_SINK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: event.event_id, ...event.payload }),
      signal: AbortSignal.timeout(cfg.INTEGRATION_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`sink responded ${res.status}`);
  }

  async function tick() {
    try {
      await withTx(pool, async (c) => {
        const { rows } = await c.query(
          `SELECT id::text AS id, event_id, payload, attempts FROM outbox_events
           WHERE published_at IS NULL AND attempts < $1 AND next_attempt_at <= now()
           ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
          [MAX_ATTEMPTS],
        );
        for (const row of rows) {
          try {
            await deliver(row);
            await c.query('UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
          } catch (err) {
            const delay = Math.min(300, 2 ** (row.attempts + 1));
            log.warn({ eventId: row.event_id, err: (err as Error).message }, 'event delivery failed; will retry');
            await c.query(
              `UPDATE outbox_events SET attempts = attempts + 1,
                 next_attempt_at = now() + ($2 || ' seconds')::interval WHERE id = $1`,
              [row.id, String(delay)],
            );
          }
        }
      });
    } catch (err) {
      log.error({ err: (err as Error).message }, 'outbox tick failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, 2000);
    }
  }

  timer = setTimeout(tick, 2000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
