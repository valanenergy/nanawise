import { ORACLE_STALENESS_MS, OracleStatus } from '@nanawise/shared';
import type { OracleState } from './types.js';

/**
 * Pre-flight trade gating + post-trade abort mapping (docs/03 §6, Phase 2 error UX).
 * `assertTradable` is a cheap pre-check to avoid burning gas on a guaranteed revert;
 * the protocol is still the final authority (the mint re-checks on-chain).
 */
export type TradeErrorCode =
  | 'STALE'
  | 'NOT_ACTIVE'
  | 'PENDING_SETTLEMENT'
  | 'SETTLED'
  | 'PAUSED';

export const HUMAN_MESSAGES = {
  STALE: 'Market is refreshing — try again in a few seconds.',
  NOT_ACTIVE: 'This strike is no longer open. Use /market for current strikes.',
  PENDING_SETTLEMENT: 'This market is settling now — trading is paused for a moment.',
  SETTLED: 'This market has settled — it redeems automatically (the keeper claims within ~60s).',
  PAUSED: 'Trading is paused on the protocol right now.',
  INSUFFICIENT: 'Not enough dUSDC in your account for this trade.',
  EXPOSURE: "The vault can't take this position right now — try a smaller amount or another strike.",
  ASK_OUT_OF_BOUNDS: 'That price moved out of range — refresh and retry.',
  GENERIC: 'Something went wrong with that trade — please try again.',
} as const;

export class TradeError extends Error {
  constructor(
    readonly code: TradeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}

/** Throw a typed, human-messaged error if the oracle can't currently be traded. */
export function assertTradable(o: OracleState, opts: { nowMs?: number; paused?: boolean } = {}): void {
  if (opts.paused) throw new TradeError('PAUSED', HUMAN_MESSAGES.PAUSED);
  switch (o.status) {
    case OracleStatus.SETTLED:
      throw new TradeError('SETTLED', HUMAN_MESSAGES.SETTLED);
    case OracleStatus.PENDING_SETTLEMENT:
      throw new TradeError('PENDING_SETTLEMENT', HUMAN_MESSAGES.PENDING_SETTLEMENT);
    case OracleStatus.INACTIVE:
      throw new TradeError('NOT_ACTIVE', HUMAN_MESSAGES.NOT_ACTIVE);
    case OracleStatus.ACTIVE:
      break;
  }
  const now = opts.nowMs ?? Date.now();
  if (o.timestampMs && now - o.timestampMs > ORACLE_STALENESS_MS) {
    throw new TradeError('STALE', HUMAN_MESSAGES.STALE);
  }
}

/** Map a post-trade on-chain abort (error string or code) to a human message. */
export function mapExecutionError(input: string | number): string {
  const s = String(input).toLowerCase();
  if (/eoraclestale|stale/.test(s)) return HUMAN_MESSAGES.STALE;
  if (/easkprice|out.?of.?bound|askbounds/.test(s)) return HUMAN_MESSAGES.ASK_OUT_OF_BOUNDS;
  if (/exposure/.test(s)) return HUMAN_MESSAGES.EXPOSURE;
  if (/eoracleexpired|pending|expired/.test(s)) return HUMAN_MESSAGES.PENDING_SETTLEMENT;
  if (/insufficient|balance/.test(s)) return HUMAN_MESSAGES.INSUFFICIENT;
  if (/paused/.test(s)) return HUMAN_MESSAGES.PAUSED;
  return HUMAN_MESSAGES.GENERIC;
}
