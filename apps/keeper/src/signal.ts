import { binaryUpPrice, descaleSvi, OracleStatus } from '@nanawise/shared';
import type { KeeperDeps } from './clients.js';

/**
 * Cross-venue signal cron (Phase 7, docs/07). Every ~5 min: compute our model BTC-up
 * probability (N(d2) at the ATM strike) and fetch a comparable Polymarket BTC market's
 * implied prob, then cache `signal:latest` for the bot `/signal` command.
 *
 * The comparison is imperfect (different expiry structures) — surfaced as informational.
 */
const POLY_GAMMA = 'https://gamma-api.polymarket.com/markets?closed=false&limit=40';

export function startSignalCron(deps: KeeperDeps, intervalMs = 5 * 60_000): () => void {
  let stopped = false;
  const tick = async () => {
    try {
      const ours = await ourBtcUpProb(deps);
      const poly = await polymarketBtcUpProb();
      if (ours != null && poly != null) {
        const payload = { ours, polymarket: poly, spread: ours - poly, updatedAt: Date.now() };
        await deps.redis.set('signal:latest', JSON.stringify(payload), 'EX', 360);
        console.log(`[signal] ours=${(ours * 100).toFixed(1)}% poly=${(poly * 100).toFixed(1)}%`);
      }
    } catch (e) {
      console.warn('[signal] tick failed:', (e as Error).message);
    }
  };
  const loop = async () => {
    while (!stopped) {
      await tick();
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

async function ourBtcUpProb(deps: KeeperDeps): Promise<number | null> {
  const now = Date.now();
  const oracles = await deps.predict.getOracles();
  const btc = oracles
    .filter((o) => /btc/i.test(o.underlyingAsset ?? '') && (o.expiryMs ?? 0) > now)
    .sort((a, b) => (a.expiryMs ?? 0) - (b.expiryMs ?? 0));
  for (const o of btc.slice(0, 6)) {
    const st = await deps.predict.getOracleState(o.oracleId);
    if (st.status === OracleStatus.ACTIVE && st.svi) {
      const fwd = Number(st.forward1e9) / 1e9;
      return binaryUpPrice(Math.round(fwd / 500) * 500, fwd, descaleSvi(st.svi));
    }
  }
  return null;
}

async function polymarketBtcUpProb(): Promise<number | null> {
  try {
    const res = await fetch(POLY_GAMMA, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const markets = (await res.json()) as Array<Record<string, unknown>>;
    const m = markets.find((x) => /bitcoin|btc/i.test(String(x.question ?? x.title ?? '')) && /up|above|reach|\$/i.test(String(x.question ?? '')));
    if (!m) return null;
    // gamma markets expose outcomePrices as a JSON-string array ["0.62","0.38"].
    const raw = m.outcomePrices ?? m.outcome_prices;
    const prices = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : (raw as string[] | undefined);
    if (Array.isArray(prices) && prices[0]) return Number(prices[0]);
    return null;
  } catch {
    return null;
  }
}
