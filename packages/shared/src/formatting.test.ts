import { describe, expect, it } from 'vitest';
import { formatStrike, formatUsdc, parseUsdc, priceToImpliedProb } from './formatting.js';

describe('parseUsdc / formatUsdc', () => {
  it('round-trips whole and fractional amounts', () => {
    expect(parseUsdc('1')).toBe(1_000_000n);
    expect(parseUsdc('12.5')).toBe(12_500_000n);
    expect(parseUsdc('0.000001')).toBe(1n);
    expect(formatUsdc(12_500_000n)).toBe('12.50');
    expect(formatUsdc(1n, 6)).toBe('0.000001');
    expect(formatUsdc(-2_500_000n)).toBe('-2.50');
  });

  it('rejects bad input', () => {
    expect(() => parseUsdc('1.2345678')).toThrow(/decimals/);
    expect(() => parseUsdc('abc')).toThrow(/invalid/);
  });
});

describe('formatStrike / priceToImpliedProb', () => {
  it('renders 1e9-scaled strike', () => {
    expect(formatStrike(65_000_000_000_000n)).toBe('65000');
  });
  it('maps a 1e9 ask to implied prob', () => {
    expect(priceToImpliedProb(500_000_000n)).toBeCloseTo(0.5, 9);
    expect(priceToImpliedProb(990_000_000)).toBeCloseTo(0.99, 9);
  });
});
