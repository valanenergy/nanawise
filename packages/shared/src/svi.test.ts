import { describe, expect, it } from 'vitest';
import { binaryUpPrice, descaleSvi, logMoneyness, normCdf, totalVariance } from './svi.js';

describe('normCdf', () => {
  it('matches known normal CDF values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 4);
  });
});

describe('SVI binary pricing', () => {
  it('prices ATM near 0.5 for a symmetric, centered surface', () => {
    // forward == strike => k = 0; rho=0,m=0 => w = a; d2 = -sqrt(a)/2, slightly below 0.5.
    const p = { a: 0.04, b: 0.1, rho: 0, m: 0, sigma: 0.1 };
    const price = binaryUpPrice(65000, 65000, p);
    expect(price).toBeGreaterThan(0.4);
    expect(price).toBeLessThan(0.5);
  });

  it('UP price rises as forward moves above strike', () => {
    const p = { a: 0.04, b: 0.1, rho: 0, m: 0, sigma: 0.1 };
    const low = binaryUpPrice(70000, 65000, p); // strike above forward => less likely UP
    const high = binaryUpPrice(60000, 65000, p); // strike below forward => more likely UP
    expect(high).toBeGreaterThan(low);
  });

  it('logMoneyness and totalVariance behave', () => {
    expect(logMoneyness(100, 100)).toBeCloseTo(0, 12);
    const p = { a: 0.04, b: 0.1, rho: -0.3, m: 0.0, sigma: 0.1 };
    expect(totalVariance(0, p)).toBeCloseTo(0.04 + 0.1 * 0.1, 9); // a + b*sigma at k=0,m=0,rho term=0
  });

  it('descales raw 1e9 params (signed rho/m)', () => {
    const d = descaleSvi({ a: 40_000_000n, b: 100_000_000n, rho: -300_000_000n, m: 0n, sigma: 100_000_000n });
    expect(d.a).toBeCloseTo(0.04, 9);
    expect(d.rho).toBeCloseTo(-0.3, 9);
  });
});
