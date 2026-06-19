import type { KeeperDeps } from './clients.js';
import { settleOracle } from './redeemer.js';

/** queryEvents cursor (structural; @mysten/sui v2 doesn't export EventId). */
type EventCursor = { txDigest: string; eventSeq: string };

/**
 * Event watcher (Phase 3). Polls `queryEvents` for the oracle module with a durable
 * Redis cursor (NOT the deprecated subscribeEvent). Handles:
 *   - OracleSettled   → settle every unredeemed position for that oracle
 *   - OracleActivated → cycle boundary (Phase 4 agent loop hook)
 *
 * A restart resumes from the saved cursor, and on first start backfills recently
 * settled oracles so downtime doesn't drop settlements.
 */
const CURSOR_KEY = 'keeper:event_cursor';

type OracleEventHandler = (oracleId: string) => Promise<void>;

export interface WatcherHooks {
  onActivated?: OracleEventHandler;
}

export async function runWatcher(deps: KeeperDeps, hooks: WatcherHooks = {}): Promise<() => void> {
  const eventModule = { package: deps.cfg.predict.predictPackageId, module: 'oracle' };
  let stopped = false;

  async function loadCursor(): Promise<EventCursor | null> {
    const v = await deps.redis.get(CURSOR_KEY);
    return v ? (JSON.parse(v) as EventCursor) : null;
  }
  async function saveCursor(c: EventCursor | null): Promise<void> {
    if (c) await deps.redis.set(CURSOR_KEY, JSON.stringify(c));
  }

  async function handle(type: string, parsed: Record<string, unknown>): Promise<void> {
    const oracleId = String(parsed.oracle_id ?? parsed.oracleId ?? '');
    if (!oracleId) return;
    if (type.endsWith('::OracleSettled')) {
      console.log(`[watcher] OracleSettled ${oracleId}`);
      await settleOracle(deps, oracleId);
    } else if (type.endsWith('::OracleActivated')) {
      if (hooks.onActivated) await hooks.onActivated(oracleId);
    }
  }

  async function tick(): Promise<void> {
    let cursor = await loadCursor();
    // Page forward until caught up.
    for (;;) {
      const page = await deps.sui.queryEvents({
        query: { MoveEventModule: eventModule },
        cursor: cursor ?? undefined,
        limit: 50,
        order: 'ascending',
      });
      if (page.data.length === 0) break;
      for (const ev of page.data) {
        try {
          await handle(ev.type, (ev.parsedJson ?? {}) as Record<string, unknown>);
        } catch (e) {
          console.error('[watcher] handler error:', (e as Error).message);
        }
      }
      cursor = page.nextCursor ?? cursor;
      await saveCursor(cursor);
      if (!page.hasNextPage) break;
    }
  }

  // On first run with no cursor, start from "now" by reading the latest event,
  // then also backfill recently settled oracles via the server.
  if (!(await loadCursor())) {
    try {
      const latest = await deps.sui.queryEvents({
        query: { MoveEventModule: eventModule },
        limit: 1,
        order: 'descending',
      });
      if (latest.data[0]) {
        await saveCursor({ txDigest: latest.data[0].id.txDigest, eventSeq: latest.data[0].id.eventSeq });
      }
    } catch (e) {
      console.warn('[watcher] could not init cursor:', (e as Error).message);
    }
  }

  const loop = async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        console.error('[watcher] tick error:', (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, deps.cfg.pollMs));
    }
  };
  void loop();
  console.log(`[watcher] polling oracle events every ${deps.cfg.pollMs}ms`);
  return () => {
    stopped = true;
  };
}
