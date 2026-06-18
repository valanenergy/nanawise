import { OracleStatus } from '@nanawise/shared';
import { describe, expect, it } from 'vitest';
import { assertTradable, HUMAN_MESSAGES, mapExecutionError, TradeError } from './tradable.js';
import type { OracleState } from './types.js';

function oracle(status: OracleStatus, timestampMs: number): OracleState {
  return {
    oracleId: '0x1',
    status,
    active: status === OracleStatus.ACTIVE,
    timestampMs,
    expiryMs: timestampMs + 3_600_000,
    spot1e9: 65_000_000_000_000n,
    forward1e9: 65_000_000_000_000n,
    raw: {},
  };
}

describe('assertTradable', () => {
  const now = 1_000_000_000;

  it('passes for a fresh ACTIVE oracle', () => {
    expect(() => assertTradable(oracle(OracleStatus.ACTIVE, now - 5_000), { nowMs: now })).not.toThrow();
  });

  it('throws STALE when older than 30s', () => {
    try {
      assertTradable(oracle(OracleStatus.ACTIVE, now - 31_000), { nowMs: now });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TradeError).code).toBe('STALE');
    }
  });

  it('throws for each non-active lifecycle state', () => {
    const cases: Array<[OracleStatus, string]> = [
      [OracleStatus.INACTIVE, 'NOT_ACTIVE'],
      [OracleStatus.PENDING_SETTLEMENT, 'PENDING_SETTLEMENT'],
      [OracleStatus.SETTLED, 'SETTLED'],
    ];
    for (const [status, code] of cases) {
      try {
        assertTradable(oracle(status, now), { nowMs: now });
        throw new Error(`should have thrown for ${status}`);
      } catch (e) {
        expect((e as TradeError).code).toBe(code);
      }
    }
  });

  it('throws PAUSED when paused regardless of status', () => {
    try {
      assertTradable(oracle(OracleStatus.ACTIVE, now), { nowMs: now, paused: true });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TradeError).code).toBe('PAUSED');
    }
  });
});

describe('mapExecutionError', () => {
  it('maps known protocol aborts to human messages', () => {
    expect(mapExecutionError('MoveAbort ... EOracleStale')).toBe(HUMAN_MESSAGES.STALE);
    expect(mapExecutionError('EAskPriceOutOfBounds')).toBe(HUMAN_MESSAGES.ASK_OUT_OF_BOUNDS);
    expect(mapExecutionError('exposure cap exceeded')).toBe(HUMAN_MESSAGES.EXPOSURE);
    expect(mapExecutionError('EOracleExpired')).toBe(HUMAN_MESSAGES.PENDING_SETTLEMENT);
    expect(mapExecutionError('Insufficient balance')).toBe(HUMAN_MESSAGES.INSUFFICIENT);
    expect(mapExecutionError('trading_paused')).toBe(HUMAN_MESSAGES.PAUSED);
    expect(mapExecutionError('something weird')).toBe(HUMAN_MESSAGES.GENERIC);
  });
});
