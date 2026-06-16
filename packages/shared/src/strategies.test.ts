import { describe, expect, it } from 'vitest';
import { contrarian, deltaNeutral, momentum, runStrategy, volHarvest, type StrategyContext } from './strategies.js';

function ctx(over: Partial<StrategyContext> = {}): StrategyContext {
  return {
    spot: 62000,
    forward: 62000,
    svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.1 },
    recentReturns: [],
    strikes: [60000, 60500, 61000, 61500, 62000, 62500, 63000, 63500, 64000],
    budgetRemaining: 10_000_000n,
    perTradeSize: 1_000_000n,
    ...over,
  };
}

describe('momentum', () => {
  it('buys nearest OTM-UP on a strong up move', () => {
    const out = momentum(ctx({ recentReturns: [0.01] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.isUp).toBe(true);
    expect(out[0]!.strike).toBe(62500); // nearest strike above spot
  });
  it('buys nearest OTM-DOWN on a strong down move', () => {
    const out = momentum(ctx({ recentReturns: [-0.01] }));
    expect(out[0]!.isUp).toBe(false);
    expect(out[0]!.strike).toBe(61500);
  });
  it('does nothing on a small move', () => {
    expect(momentum(ctx({ recentReturns: [0.001] }))).toEqual([]);
  });
});

describe('contrarian', () => {
  it('fades a big up move (bets down)', () => {
    const out = contrarian(ctx({ recentReturns: [0.02] }));
    expect(out[0]!.isUp).toBe(false);
  });
  it('ignores moderate moves', () => {
    expect(contrarian(ctx({ recentReturns: [0.01] }))).toEqual([]);
  });
});

describe('deltaNeutral', () => {
  it('returns two legs straddling spot, split budget', () => {
    const out = deltaNeutral(ctx());
    expect(out).toHaveLength(2);
    expect(out.some((d) => d.isUp)).toBe(true);
    expect(out.some((d) => !d.isUp)).toBe(true);
    expect(out[0]!.strike).toBeGreaterThanOrEqual(62000 * 1.01);
    expect(out[1]!.strike).toBeLessThanOrEqual(62000 * 0.99);
  });
});

describe('volHarvest', () => {
  it('returns at most one leg and respects the 2pp edge floor', () => {
    const out = volHarvest(ctx({ recentReturns: [0.001, -0.002, 0.0015, -0.001] }));
    expect(out.length).toBeLessThanOrEqual(1);
    if (out.length) expect(out[0]!.quantity).toBeGreaterThan(0n);
  });
});

describe('sizing & dispatch', () => {
  it('caps leg size at perTradeSize', () => {
    const out = momentum(ctx({ recentReturns: [0.01], perTradeSize: 500_000n }));
    expect(out[0]!.quantity).toBe(500_000n);
  });
  it('caps leg size at remaining budget when smaller', () => {
    const out = momentum(ctx({ recentReturns: [0.01], budgetRemaining: 300_000n, perTradeSize: 1_000_000n }));
    expect(out[0]!.quantity).toBe(300_000n);
  });
  it('runStrategy dispatches by name', () => {
    expect(() => runStrategy('momentum', ctx({ recentReturns: [0.01] }))).not.toThrow();
    expect(() => runStrategy('bogus' as never, ctx())).toThrow(/unknown strategy/);
  });
});
