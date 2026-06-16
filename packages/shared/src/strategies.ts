import { binaryUpPrice, normCdf, type SVIParams } from './svi.js';

/**
 * Agent strategies (Phase 4, docs/04). Each is a PURE function so it's unit-testable:
 *   (context) → decisions[]   (0, 1, or 2 legs; delta-neutral returns 2)
 *
 * Strategies are SYSTEMATIC, not predictive — they exploit model-vs-realized gaps and
 * simple momentum/mean-reversion. Pricing uses the verified SVI N(d2) form (no IV·√T).
 */

export type StrategyName = 'vol-harvest' | 'momentum' | 'contrarian' | 'delta-neutral';

export interface StrategyContext {
  spot: number; // price (decimal $)
  forward: number; // price
  svi: SVIParams; // de-scaled
  recentReturns: number[]; // recent log-returns (e.g. hourly) for vol/momentum
  strikes: number[]; // available strike prices on the grid
  budgetRemaining: bigint; // 1e6 dUSDC
  perTradeSize: bigint; // 1e6 dUSDC face per leg
}

export interface StrategyDecision {
  strike: number; // price ($) — caller scales to 1e9
  isUp: boolean;
  quantity: bigint; // 1e6
}

/** stdev of an array (population). */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

/** Realized P(UP) for a strike from a lognormal with realized stdev over the tenor. */
function realizedUpProb(strike: number, forward: number, sigmaTenor: number): number {
  if (sigmaTenor <= 0) return strike <= forward ? 1 : 0;
  const k = Math.log(strike / forward);
  // P(S_T >= K) under lognormal with drift ~0 over the tenor: N((-k - σ²/2)/σ)
  const d = (-k - (sigmaTenor * sigmaTenor) / 2) / sigmaTenor;
  return normCdf(d);
}

const nearestUpStrike = (strikes: number[], spot: number) =>
  strikes.filter((s) => s > spot).sort((a, b) => a - b)[0];
const nearestDownStrike = (strikes: number[], spot: number) =>
  strikes.filter((s) => s < spot).sort((a, b) => b - a)[0];

function legSize(ctx: StrategyContext, legs = 1): bigint {
  const perLeg = ctx.budgetRemaining / BigInt(legs);
  return ctx.perTradeSize < perLeg ? ctx.perTradeSize : perLeg;
}

/**
 * vol-harvest: buy the strike with the largest gap between the model binary price
 * (N(d2)) and a realized-probability estimate; side = whichever is underpriced.
 */
export function volHarvest(ctx: StrategyContext): StrategyDecision[] {
  const sigmaTenor = stdev(ctx.recentReturns) * Math.sqrt(Math.max(1, ctx.recentReturns.length));
  let best: { strike: number; gap: number; isUp: boolean } | null = null;
  for (const strike of ctx.strikes) {
    const model = binaryUpPrice(strike, ctx.forward, ctx.svi); // model P(UP)
    const realized = realizedUpProb(strike, ctx.forward, sigmaTenor);
    const gap = realized - model; // >0 → UP underpriced by model; buy UP
    const absGap = Math.abs(gap);
    const tieAtm = best && absGap === Math.abs(best.gap) ? Math.abs(strike - ctx.forward) < Math.abs(best.strike - ctx.forward) : true;
    if (!best || absGap > Math.abs(best.gap) || (absGap === Math.abs(best.gap) && tieAtm)) {
      best = { strike, gap, isUp: gap > 0 };
    }
  }
  if (!best || Math.abs(best.gap) < 0.02) return []; // ignore <2pp edge
  const qty = legSize(ctx);
  return qty > 0n ? [{ strike: best.strike, isUp: best.isUp, quantity: qty }] : [];
}

/** momentum: 1h move > +0.5% → nearest OTM-UP; < −0.5% → nearest OTM-DOWN; else none. */
export function momentum(ctx: StrategyContext): StrategyDecision[] {
  const move = ctx.recentReturns.at(-1) ?? 0;
  const qty = legSize(ctx);
  if (qty <= 0n) return [];
  if (move > 0.005) {
    const s = nearestUpStrike(ctx.strikes, ctx.spot);
    return s ? [{ strike: s, isUp: true, quantity: qty }] : [];
  }
  if (move < -0.005) {
    const s = nearestDownStrike(ctx.strikes, ctx.spot);
    return s ? [{ strike: s, isUp: false, quantity: qty }] : [];
  }
  return [];
}

/** contrarian: |1h move| > 1.5% → take the opposite side (mean reversion). */
export function contrarian(ctx: StrategyContext): StrategyDecision[] {
  const move = ctx.recentReturns.at(-1) ?? 0;
  const qty = legSize(ctx);
  if (qty <= 0n) return [];
  if (move > 0.015) {
    const s = nearestDownStrike(ctx.strikes, ctx.spot); // bet reversion down
    return s ? [{ strike: s, isUp: false, quantity: qty }] : [];
  }
  if (move < -0.015) {
    const s = nearestUpStrike(ctx.strikes, ctx.spot); // bet reversion up
    return s ? [{ strike: s, isUp: true, quantity: qty }] : [];
  }
  return [];
}

/** delta-neutral: buy equal UP and DOWN at ±~1% of spot (time-decay harvest). */
export function deltaNeutral(ctx: StrategyContext): StrategyDecision[] {
  const up = ctx.strikes.filter((s) => s >= ctx.spot * 1.01).sort((a, b) => a - b)[0];
  const down = ctx.strikes.filter((s) => s <= ctx.spot * 0.99).sort((a, b) => b - a)[0];
  const qty = legSize(ctx, 2);
  if (qty <= 0n || !up || !down) return [];
  return [
    { strike: up, isUp: true, quantity: qty },
    { strike: down, isUp: false, quantity: qty },
  ];
}

export const STRATEGIES: Record<StrategyName, (ctx: StrategyContext) => StrategyDecision[]> = {
  'vol-harvest': volHarvest,
  momentum,
  contrarian,
  'delta-neutral': deltaNeutral,
};

export function runStrategy(name: StrategyName, ctx: StrategyContext): StrategyDecision[] {
  const fn = STRATEGIES[name];
  if (!fn) throw new Error(`unknown strategy: ${name}`);
  return fn(ctx);
}
