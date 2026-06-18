import { OracleStatus } from '@nanawise/shared';
import { describe, expect, it } from 'vitest';
import { normalizeOracleState, parseI64, signedWithSibling } from './server.js';

// Captured verbatim from predict-server.testnet.mystenlabs.com (2026-06) — locks the
// real shape so the "silent spot=0 / inactive" parser regression can't recur.
const REAL_STATE = {
  oracle: {
    oracle_id: '0x2a46213beef062f95b6328abbac3893f847a90c8df9c2341fcdf1168754d048e',
    underlying_asset: 'BTC',
    // Far-future expiry so the ACTIVE assertion is time-independent (the live capture's
    // real expiry is now in the past; status mapping past-expiry→PENDING is tested separately).
    expiry: 4_000_000_000_000,
    status: 'active',
    settlement_price: null,
    activated_at: 1781824626498,
  },
  latest_price: {
    spot: 62758239775481,
    forward: 62758752949025,
    onchain_timestamp: 1781824864718,
  },
  latest_svi: {
    a: 24863,
    b: 1119607,
    rho: 714590875,
    rho_negative: true,
    m: 2065468,
    m_negative: true,
    sigma: 1221516,
  },
};

describe('normalizeOracleState (real server shape)', () => {
  const s = normalizeOracleState('0x2a46', REAL_STATE);

  it('reads spot/forward from latest_price (not 0)', () => {
    expect(s.spot1e9).toBe(62758239775481n);
    expect(s.forward1e9).toBe(62758752949025n);
  });

  it('maps string status "active" to ACTIVE', () => {
    expect(s.status).toBe(OracleStatus.ACTIVE);
    expect(s.active).toBe(true);
  });

  it('applies the *_negative sign flags to signed SVI fields', () => {
    expect(s.svi?.rho).toBe(-714590875n);
    expect(s.svi?.m).toBe(-2065468n);
    expect(s.svi?.a).toBe(24863n);
    expect(s.svi?.sigma).toBe(1221516n);
  });

  it('uses onchain_timestamp for freshness', () => {
    expect(s.timestampMs).toBe(1781824864718);
  });

  it('marks settled when settlement_price present', () => {
    const settled = normalizeOracleState('0x1', {
      oracle: { status: 'active', settlement_price: 60000000000000, expiry: 1 },
      latest_price: { spot: 1, forward: 1 },
    });
    expect(settled.status).toBe(OracleStatus.SETTLED);
  });
});

describe('signed I64 decoding', () => {
  it('parseI64 handles strings, ints, two-complement {bits}, and {value,is_negative}', () => {
    expect(parseI64('-123')).toBe(-123n);
    expect(parseI64(456)).toBe(456n);
    expect(parseI64({ value: '789', is_negative: true })).toBe(-789n);
    // two's complement -1 in u64
    expect(parseI64({ bits: (1n << 64n) - 1n })).toBe(-1n);
  });

  it('signedWithSibling applies <key>_negative', () => {
    expect(signedWithSibling({ rho: 100, rho_negative: true }, 'rho')).toBe(-100n);
    expect(signedWithSibling({ rho: 100 }, 'rho')).toBe(100n);
    expect(signedWithSibling({}, 'rho')).toBeUndefined();
  });
});
