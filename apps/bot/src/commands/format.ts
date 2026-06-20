import { formatStrike, formatUsdc, priceToImpliedProb } from '@nanawise/shared';
import type { OracleState, PredictClient } from '@nanawise/predict-sdk';

/** Minutes until expiry, human. */
export function timeToExpiry(expiryMs: number, nowMs = Date.now()): string {
  const min = Math.max(0, Math.round((expiryMs - nowMs) / 60000));
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

/** Build a compact strike table around the forward (UP cost + implied prob per strike). */
export async function renderMarket(
  predict: PredictClient,
  o: OracleState,
  sender: string,
  strikesEachSide = 3,
): Promise<string> {
  const fwd = o.forward1e9;
  const FIVE_HUNDRED = 500_000_000_000n;
  // Round the forward to the NEAREST $500 grid strike so the ATM marker is correct.
  const base = ((fwd + FIVE_HUNDRED / 2n) / FIVE_HUNDRED) * FIVE_HUNDRED;
  const rows: string[] = [];
  for (let i = -strikesEachSide; i <= strikesEachSide; i++) {
    const strike = base + BigInt(i) * FIVE_HUNDRED;
    if (strike <= 0n) continue;
    const atm = i === 0 ? ' ⟵ ATM' : '';
    try {
      const pv = await predict.previewMint(
        { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike, isUp: true, quantity: 1_000_000n },
        sender,
      );
      rows.push(
        `$${formatStrike(strike).padStart(6)}  UP ${(pv.impliedProb * 100).toFixed(0).padStart(3)}%  ${formatUsdc(pv.cost)}${atm}`,
      );
    } catch {
      rows.push(`$${formatStrike(strike).padStart(6)}  —  (unavailable)${atm}`);
    }
  }
  return [
    `*BTC market* — spot $${formatStrike(o.spot1e9)} · expires in ${timeToExpiry(o.expiryMs)}`,
    '```',
    'strike    side  prob   cost',
    ...rows,
    '```',
    '_UP pays $1/contract if BTC ≥ strike at expiry._',
  ].join('\n');
}

/** Implied prob from a 1e9 ask (helper for /market button). */
export function impliedPct(ask1e9: bigint): string {
  return `${(priceToImpliedProb(ask1e9) * 100).toFixed(1)}%`;
}
