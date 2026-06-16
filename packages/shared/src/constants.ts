/**
 * Protocol constants — verified against deepbookv3 @ predict-testnet-4-16.
 * See docs/03-protocol-integration.md §5.
 */

/** Price fixed-point scaling: 1e9. A binary ask of 500_000_000 = $0.50 = 50% implied prob. */
export const FLOAT_SCALING = 1_000_000_000n;

/** dUSDC and PLP both use 6 decimals. */
export const USDC_DECIMALS = 6;

/** 1 dUSDC = 1_000_000 base units. Quantity 1_000_000 = 1 contract = $1 face value at settlement. */
export const USDC_SCALING = 1_000_000n;

/** A mint aborts if `now > oracle.timestamp + 30_000ms` (EOracleStale). Timestamps are in ms. */
export const ORACLE_STALENESS_MS = 30_000;

/** Oracle lifecycle — derive via oracle::status(oracle, clock). */
export enum OracleStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  PENDING_SETTLEMENT = 2,
  SETTLED = 3,
}

/** MarketKey.direction encoding. */
export enum Direction {
  UP = 0,
  DOWN = 1,
}

/**
 * activity_log action types (our Move packages, Phase 4+). MUST match the on-chain
 * `activity_log::emit_action` encoding and Postgres AgentAction.actionType strings.
 */
export enum ActionType {
  MINT = 0,
  REDEEM = 1,
  MINT_RANGE = 2,
  RETURN_FUNDS = 3,
  LEVERAGE = 4,
  COPY = 5,
}

/** Numeric ActionType → Postgres actionType label (docs/05). */
export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  [ActionType.MINT]: 'mint',
  [ActionType.REDEEM]: 'redeem',
  [ActionType.MINT_RANGE]: 'mint_range',
  [ActionType.RETURN_FUNDS]: 'return_funds',
  [ActionType.LEVERAGE]: 'leverage',
  [ActionType.COPY]: 'copy',
};

/** The well-known shared Clock object. */
export const CLOCK_OBJECT_ID = '0x6';

/** Streak badge for a current win-streak (docs/07: 🔥3 / 💎10 / 👑25). */
export function streakBadge(current: number): string {
  if (current >= 25) return '👑';
  if (current >= 10) return '💎';
  if (current >= 3) return '🔥';
  return '';
}
