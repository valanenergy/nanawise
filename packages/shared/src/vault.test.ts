import { describe, expect, it } from 'vitest';
import {
  limiterAvailableNow,
  maxWithdrawable,
  plpPrice,
  previewSupplyPlp,
  previewWithdrawDusdc,
  vaultNav,
  whatIf,
  type LimiterSnapshot,
  type VaultSnapshot,
} from './vault.js';

const vault: VaultSnapshot = {
  balance: 1_000_000_000n, // 1000 dUSDC
  totalMtm: 100_000_000n, // 100 liability → NAV 900
  totalMaxPayout: 300_000_000n,
  plpSupply: 900_000_000n, // 900 PLP → price 1.00
};

describe('share math', () => {
  it('NAV and PLP price', () => {
    expect(vaultNav(vault)).toBe(900_000_000n);
    expect(plpPrice(vault)).toBeCloseTo(1.0, 9);
  });
  it('bootstraps 1:1 when no supply', () => {
    expect(previewSupplyPlp({ ...vault, plpSupply: 0n }, 50_000_000n)).toBe(50_000_000n);
  });
  it('supply is pro-rata of NAV', () => {
    // NAV 900, supply 900 → 90 dUSDC mints 90 PLP at price 1.0
    expect(previewSupplyPlp(vault, 90_000_000n)).toBe(90_000_000n);
  });
  it('withdraw is pro-rata of NAV', () => {
    expect(previewWithdrawDusdc(vault, 90_000_000n)).toBe(90_000_000n);
  });
});

describe('withdrawal limiter', () => {
  const lim: LimiterSnapshot = {
    available: 100_000_000n,
    capacity: 500_000_000n,
    refillRatePerMs: 1000n, // 0.001 dUSDC/ms
    enabled: true,
    lastUpdatedMs: 0,
  };
  it('refills over time, capped at capacity', () => {
    expect(limiterAvailableNow(lim, 100_000)).toBe(200_000_000n); // +100k ms * 1000
    expect(limiterAvailableNow(lim, 10_000_000)).toBe(500_000_000n); // capped
  });
  it('disabled limiter returns capacity (no extra constraint)', () => {
    expect(limiterAvailableNow({ ...lim, enabled: false }, 0)).toBe(500_000_000n);
  });
  it('maxWithdrawable = min(coverage, limiter)', () => {
    // coverage = balance - maxPayout = 1000 - 300 = 700; limiter at t=0 = 100 → min = 100
    expect(maxWithdrawable(vault, lim, 0)).toBe(100_000_000n);
    // disabled limiter → coverage governs
    expect(maxWithdrawable(vault, { ...lim, enabled: false }, 0)).toBe(700_000_000n);
  });
});

describe('whatIf golden example', () => {
  it('a +5% BTC move raises vault UP-liability and lowers PLP price', () => {
    const r = whatIf({
      vault,
      spot: 62000,
      forward: 62000,
      svi: { a: 0.04, b: 0.1, rho: 0, m: 0, sigma: 0.1 },
      strike: 62000, // ATM
      openUpQty: 100_000_000n, // vault short 100 UP contracts
      pctMove: 0.05,
    });
    // ATM ~0.46 → after +5% forward, P(UP) rises toward ~0.9 → liability up → NAV down → PLP down
    expect(r.liabilityAfter).toBeGreaterThan(r.liabilityBefore);
    expect(r.plpPriceAfter).toBeLessThan(r.plpPriceBefore);
    expect(r.plpPriceChangePct).toBeLessThan(0);
    expect(r.newForward).toBeCloseTo(65100, 0);
  });
});
