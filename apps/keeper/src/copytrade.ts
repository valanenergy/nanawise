import { prisma } from '@nanawise/db';
import type { KeeperDeps } from './clients.js';

/**
 * Copy-trade watcher (Phase 7, docs/07). Polls predict `PositionMinted` events; for
 * each consenting target's trade, enqueues a `copy-trade` job per active follower.
 *
 * Custody-aware (validated): the backend can't sign for client-held-key followers, so
 * the default mode is **confirm** (follower one-tap signs in the Mini App). The
 * **agent** mode is an opt-in path the worker injects into the follower's agent PTB.
 * Here we only DETECT + ENQUEUE; execution/notification happens in the bot worker.
 */
const CURSOR_KEY = 'copytrade:cursor';

type EventCursor = { txDigest: string; eventSeq: string };

export function startCopyTradeWatcher(deps: KeeperDeps, pollMs = 8000): () => void {
  const eventModule = { package: deps.cfg.predict.predictPackageId, module: 'predict' };
  let stopped = false;

  async function tick(): Promise<void> {
    const raw = await deps.redis.get(CURSOR_KEY);
    let cursor: EventCursor | null = raw ? (JSON.parse(raw) as EventCursor) : null;
    for (;;) {
      const page = await deps.sui.queryEvents({
        query: { MoveEventModule: eventModule },
        cursor: cursor ?? undefined,
        limit: 50,
        order: 'ascending',
      });
      if (page.data.length === 0) break;
      for (const ev of page.data) {
        if (!ev.type.endsWith('::PositionMinted')) continue;
        await handleMint(deps, (ev.parsedJson ?? {}) as Record<string, unknown>);
      }
      cursor = (page.nextCursor as EventCursor | null) ?? cursor;
      if (cursor) await deps.redis.set(CURSOR_KEY, JSON.stringify(cursor));
      if (!page.hasNextPage) break;
    }
  }

  // init cursor at the tip so we only copy NEW trades.
  (async () => {
    if (!(await deps.redis.get(CURSOR_KEY))) {
      const latest = await deps.sui
        .queryEvents({ query: { MoveEventModule: eventModule }, limit: 1, order: 'descending' })
        .catch(() => null);
      if (latest?.data[0]) {
        await deps.redis.set(CURSOR_KEY, JSON.stringify({ txDigest: latest.data[0].id.txDigest, eventSeq: latest.data[0].id.eventSeq }));
      }
    }
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        console.error('[copytrade] tick error:', (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  })();

  console.log('[copytrade] watching PositionMinted');
  return () => {
    stopped = true;
  };
}

async function handleMint(deps: KeeperDeps, ev: Record<string, unknown>): Promise<void> {
  const trader = String(ev.trader ?? '');
  if (!trader) return;
  const target = await prisma.user.findFirst({ where: { suiAddress: trader } });
  if (!target) return;

  // followers who copy this target with the target's consent
  const follows = await prisma.copyTrade.findMany({
    where: { targetId: target.id, active: true, consent: true },
    include: { follower: true },
  });
  for (const f of follows) {
    // Mode: 'confirm' (default — follower signs each mirror) or 'agent' (opt-in, the
    // follower set a copy-agent flag; their agent path injects the mint). Custody-safe
    // either way: agent mode still spends only the follower's own budget escrow.
    const agentOptIn = (await deps.redis.get(`copy_agent:${f.followerId}`)) === '1';
    await deps.copyQueue.add('copy-trade', {
      follower_id: f.followerId,
      targetId: f.targetId,
      followerTelegramId: f.follower.telegramId.toString(),
      oracle: String(ev.oracle_id ?? ''),
      expiry: String(ev.expiry ?? ''),
      strike: String(ev.strike ?? ''),
      isUp: ev.is_up === true,
      sizing: f.fraction ? { fraction: Number(f.fraction) } : { fixedAmount: f.fixedAmount?.toString() },
      mode: agentOptIn ? 'agent' : 'confirm',
    });
  }
}
