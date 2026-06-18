import type { OracleStatus } from '@nanawise/shared';

/** SDK configuration (resolved from shared config). */
export interface PredictSdkConfig {
  rpcUrl: string;
  serverUrl: string;
  predictPackageId: string;
  predictObjectId: string;
  predictRegistryId: string;
  dusdcType: string;
  plpType: string;
  clockId: string;
  /** Our Move packages (Phase 4) — optional until deployed. */
  agentPolicyPackageId?: string;
  activityLogPackageId?: string;
}

/** A reference to an oracle as listed by the predict-server. */
export interface OracleRef {
  oracleId: string;
  underlyingAsset?: string;
  expiryMs?: number;
  raw: unknown;
}

/** Normalized oracle state (spot/forward/svi/lifecycle). */
export interface OracleState {
  oracleId: string;
  status: OracleStatus;
  active: boolean;
  timestampMs: number;
  expiryMs: number;
  spot1e9: bigint;
  forward1e9: bigint;
  settlementPrice1e9?: bigint;
  svi?: { a: bigint; b: bigint; rho: bigint; m: bigint; sigma: bigint };
  raw: unknown;
}

export interface MintParams {
  managerId: string;
  oracleId: string;
  expiry: bigint; // ms
  strike: bigint; // 1e9
  isUp: boolean;
  quantity: bigint; // 1e6 units
}

/** Binary redeem (early-exit or, for the keeper, permissionless settled-claim). */
export type RedeemParams = MintParams;

/** For the keeper: managerId is the OWNER's manager; signer = keeper. Binary only. */
export type RedeemPermissionlessParams = MintParams;

export interface RangeMintParams {
  managerId: string;
  oracleId: string;
  expiry: bigint; // ms
  lowerStrike: bigint; // 1e9
  higherStrike: bigint; // 1e9
  quantity: bigint; // 1e6
}

/** Range redeem (OWNER-gated — no permissionless path for ranges, docs/03 §10). */
export type RangeRedeemParams = RangeMintParams;

export interface DepositParams {
  managerId: string;
  coinType: string;
  amount: bigint; // base units
}

export interface TradeAmounts {
  cost: bigint; // mint_cost, base units
  payout: bigint; // redeem_payout, base units
  impliedProb: number;
}

/** Parsed on-chain PredictManager view. */
export interface ManagerObject {
  managerId: string;
  owner: string;
  raw: unknown;
}

/** A PositionMinted event row from predict-server. */
export interface MintRecord {
  managerId: string;
  trader: string; // = owner
  oracleId: string;
  expiry: bigint; // ms
  strike: bigint; // 1e9
  isUp: boolean;
  quantity: bigint; // 1e6
  cost: bigint;
  askPrice: bigint;
  digest: string;
  checkpointMs: number;
  raw: unknown;
}

/** A PositionRedeemed event row from predict-server. */
export interface RedeemRecord {
  managerId: string;
  owner: string;
  executor: string;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  payout: bigint;
  bidPrice: bigint;
  isSettled: boolean;
  digest: string;
  raw: unknown;
}

/** Parsed AgentPolicy escrow object (Phase 4). */
export interface AgentPolicyState {
  policyId: string;
  owner: string;
  agent: string;
  budgetRemaining: bigint; // = escrow balance (authoritative meter)
  budgetCap: bigint;
  spent: bigint;
  expiryEpoch: bigint;
  revoked: boolean;
  strategy: string;
  raw: unknown;
}

export interface CreatePolicyParams {
  agent: string;
  expiryEpoch: bigint;
  strategy: string;
  fundingAmount: bigint; // dUSDC pulled from the owner's wallet
}

export interface AgentTradeParams {
  policyId: string;
  agentManagerId: string;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  requestAmount: bigint; // buffered escrow draw (ceil(cost·(1+ε)))
  ownerAddress: string; // for the activity log event
  strategy: string;
}

/** A RangeMinted event row. */
export interface RangeMintRecord {
  managerId: string;
  trader: string;
  oracleId: string;
  expiry: bigint;
  lowerStrike: bigint;
  higherStrike: bigint;
  quantity: bigint;
  cost: bigint;
  digest: string;
  raw: unknown;
}
