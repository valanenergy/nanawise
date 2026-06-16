import type { OracleStatus } from './constants.js';

/** A binary market key (oracle + expiry + strike + direction). */
export interface MarketKeyFields {
  oracleId: string;
  expiry: bigint; // ms
  strike: bigint; // 1e9-scaled price
  isUp: boolean;
}

/** A range market key (oracle + expiry + [lower, higher) strikes). */
export interface RangeKeyFields {
  oracleId: string;
  expiry: bigint; // ms
  lowerStrike: bigint; // 1e9
  higherStrike: bigint; // 1e9
}

/** Minimal oracle view used for lifecycle/freshness gating. */
export interface OracleLifecycle {
  oracleId: string;
  status: OracleStatus;
  timestampMs: number;
  expiryMs: number;
  spot: bigint; // 1e9
  forward: bigint; // 1e9
  settlementPrice?: bigint; // 1e9, set once SETTLED
}
