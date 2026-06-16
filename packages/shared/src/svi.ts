import { FLOAT_SCALING } from './constants.js';

/**
 * SVI binary-option pricing — mirrors the on-chain form (docs/03 §5, verified).
 *
 *   k = ln(strike / forward)                       (log-moneyness)
 *   w(k) = a + b·(ρ·(k − m) + √((k − m)² + σ²))    (TOTAL variance for the tenor)
 *   binary UP price = N(d2),  d2 = −((k + w/2) / √w)
 *
 * IMPORTANT: the surface is total variance already scaled to the tenor — there is
 * NO time/annualization term on-chain. Do NOT use a Black-Scholes IV·√T form.
 * On-chain params/prices are 1e9 fixed point with ρ, m SIGNED; use `descaleSvi`
 * to convert raw object fields into the decimal `SVIParams` these functions take.
 */

/** Decimal (de-scaled) SVI parameters. */
export interface SVIParams {
  a: number;
  b: number;
  rho: number; // signed, typically (-1, 1)
  m: number; // signed
  sigma: number; // > 0
}

/** Raw on-chain SVI fields (1e9 fixed point; rho/m carry sign). */
export interface RawSVIParams {
  a: bigint;
  b: bigint;
  rho: bigint;
  m: bigint;
  sigma: bigint;
}

const SCALE = Number(FLOAT_SCALING);

/** Convert raw 1e9-scaled on-chain SVI fields into decimal params. */
export function descaleSvi(raw: RawSVIParams): SVIParams {
  return {
    a: Number(raw.a) / SCALE,
    b: Number(raw.b) / SCALE,
    rho: Number(raw.rho) / SCALE,
    m: Number(raw.m) / SCALE,
    sigma: Number(raw.sigma) / SCALE,
  };
}

/** Log-moneyness k = ln(strike / forward). Both inputs are plain prices (same scale). */
export function logMoneyness(strike: number, forward: number): number {
  if (strike <= 0 || forward <= 0) throw new Error('logMoneyness: strike/forward must be > 0');
  return Math.log(strike / forward);
}

/** Total variance w(k) for the tenor. */
export function totalVariance(k: number, p: SVIParams): number {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sigma * p.sigma));
}

/**
 * Implied vol FOR THE TENOR = √w. (Not annualized — the feeder pushes variance
 * already scaled to the tenor.) Useful for surface display.
 */
export function impliedVol(strike: number, forward: number, p: SVIParams): number {
  const w = totalVariance(logMoneyness(strike, forward), p);
  return Math.sqrt(Math.max(w, 0));
}

/** Binary UP price = N(d2) ∈ [0,1]. */
export function binaryUpPrice(strike: number, forward: number, p: SVIParams): number {
  const k = logMoneyness(strike, forward);
  const w = totalVariance(k, p);
  if (w <= 0) return k < 0 ? 1 : 0; // degenerate: forward above/below strike with no variance
  const sqrtW = Math.sqrt(w);
  const d2 = -((k + w / 2) / sqrtW);
  return normCdf(d2);
}

/** Binary DOWN price = 1 − binary UP price. */
export function binaryDownPrice(strike: number, forward: number, p: SVIParams): number {
  return 1 - binaryUpPrice(strike, forward, p);
}

/**
 * Standard normal CDF via the erf rational approximation (Abramowitz & Stegun 7.1.26).
 * Max abs error ~1.5e-7 — ample for display and strategy decisions.
 */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
