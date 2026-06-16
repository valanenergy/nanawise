import { FLOAT_SCALING, USDC_DECIMALS, USDC_SCALING } from './constants.js';

/**
 * Human↔base-unit conversions for 6-decimal dUSDC/PLP and 1e9 prices.
 * All on-chain amounts are bigints; never use JS floats for money.
 */

/** "12.5" -> 12_500_000n. Rejects more than 6 fractional digits. */
export function parseUsdc(human: string | number): bigint {
  const s = typeof human === 'number' ? human.toString() : human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`parseUsdc: invalid amount "${human}"`);
  const parts = s.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  if (frac.length > USDC_DECIMALS) {
    throw new Error(`parseUsdc: too many decimals (max ${USDC_DECIMALS}) in "${human}"`);
  }
  const padded = frac.padEnd(USDC_DECIMALS, '0');
  return BigInt(whole) * USDC_SCALING + BigInt(padded || '0');
}

/** 12_500_000n -> "12.50". Trims to `maxFractionDigits` (default 2). */
export function formatUsdc(base: bigint, maxFractionDigits = 2): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const whole = abs / USDC_SCALING;
  const frac = abs % USDC_SCALING;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, maxFractionDigits);
  const sign = neg ? '-' : '';
  return maxFractionDigits > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

/** Strike is stored as a 1e9-scaled price; render as a plain dollar figure. */
export function formatStrike(strike1e9: bigint, maxFractionDigits = 0): string {
  const whole = strike1e9 / FLOAT_SCALING;
  const frac = strike1e9 % FLOAT_SCALING;
  if (maxFractionDigits === 0) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').slice(0, maxFractionDigits);
  return `${whole}.${fracStr}`;
}

/** Convert a 1e9-scaled binary ask price to an implied probability in [0,1]. */
export function priceToImpliedProb(ask1e9: bigint | number): number {
  const n = typeof ask1e9 === 'bigint' ? Number(ask1e9) : ask1e9;
  return n / Number(FLOAT_SCALING);
}

/** Fixed-point multiply two 1e9-scaled-ish values the way math::mul does: (a*b)/scale. */
export function mulFloat(aScaled: bigint, bUnits: bigint, scale: bigint = FLOAT_SCALING): bigint {
  return (aScaled * bUnits) / scale;
}
