import { coinWithBalance, Transaction } from '@mysten/sui/transactions';
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import type {
  DepositParams,
  MintParams,
  PredictSdkConfig,
  RangeMintParams,
  RangeRedeemParams,
  RedeemParams,
  RedeemPermissionlessParams,
} from './types.js';

/**
 * PTB builders. Each accepts an optional existing `tx` for composition (the agent
 * PTB chains escrow→deposit→mint→emit_action). Builders NEVER sign or sponsor —
 * they only construct an unsigned Transaction (docs/02 boundary rule).
 *
 * Signatures verified against deepbookv3 @ predict-testnet-4-16 (docs/03 §3).
 */

/** Construct a MarketKey value inside `tx` via market_key::new. */
export function marketKeyArg(
  tx: Transaction,
  cfg: PredictSdkConfig,
  f: { oracleId: string; expiry: bigint; strike: bigint; isUp: boolean },
): TransactionObjectArgument {
  return tx.moveCall({
    target: `${cfg.predictPackageId}::market_key::new`,
    arguments: [
      tx.pure.id(f.oracleId),
      tx.pure.u64(f.expiry),
      tx.pure.u64(f.strike),
      tx.pure.bool(f.isUp),
    ],
  });
}

/** create_manager(ctx) — shares the manager and emits PredictManagerCreated. */
export function buildCreateManager(cfg: PredictSdkConfig, tx: Transaction = new Transaction()): Transaction {
  tx.moveCall({ target: `${cfg.predictPackageId}::predict::create_manager`, arguments: [] });
  return tx;
}

/**
 * deposit<T>(manager, coin, ctx) — owner-gated. REQUIRED before mint: mint spends
 * the manager's INTERNAL balance and takes no Coin argument (docs/03 §5, CC-1).
 * Pulls `amount` from the sender's wallet via coinWithBalance.
 */
export function buildDeposit(
  cfg: PredictSdkConfig,
  p: DepositParams,
  tx: Transaction = new Transaction(),
): Transaction {
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict_manager::deposit`,
    typeArguments: [p.coinType],
    arguments: [tx.object(p.managerId), coinWithBalance({ type: p.coinType, balance: p.amount })],
  });
  return tx;
}

/** mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx). */
export function buildMint(
  cfg: PredictSdkConfig,
  p: MintParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = marketKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::mint`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/** redeem<Quote>(predict, manager, oracle, key, quantity, clock, ctx) — pre-settlement early exit. */
export function buildRedeem(
  cfg: PredictSdkConfig,
  p: RedeemParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = marketKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::redeem`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/**
 * redeem_permissionless<Quote>(...) — BINARY ONLY (docs/03 §10). `p.managerId` is the
 * OWNER's manager; the keeper signs. Used by Phase 3 settlement.
 */
export function buildRedeemPermissionless(
  cfg: PredictSdkConfig,
  p: RedeemPermissionlessParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = marketKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::redeem_permissionless`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/** Construct a RangeKey value (range_key::new asserts lower < higher). */
export function rangeKeyArg(
  tx: Transaction,
  cfg: PredictSdkConfig,
  f: { oracleId: string; expiry: bigint; lowerStrike: bigint; higherStrike: bigint },
): TransactionObjectArgument {
  return tx.moveCall({
    target: `${cfg.predictPackageId}::range_key::new`,
    arguments: [
      tx.pure.id(f.oracleId),
      tx.pure.u64(f.expiry),
      tx.pure.u64(f.lowerStrike),
      tx.pure.u64(f.higherStrike),
    ],
  });
}

/** mint_range<Quote>(predict, manager, oracle, key, quantity, clock, ctx). */
export function buildMintRange(
  cfg: PredictSdkConfig,
  p: RangeMintParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = rangeKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::mint_range`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/** redeem_range<Quote>(...) — OWNER-gated (no keeper path). */
export function buildRedeemRange(
  cfg: PredictSdkConfig,
  p: RangeRedeemParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = rangeKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::redeem_range`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/**
 * supply<Quote>(predict, coin, clock, ctx): Coin<PLP> — deposit dUSDC, receive PLP.
 * PLP is a USER-HELD coin → transfer it to the sender (docs/03 §8, Phase 6).
 */
export function buildSupply(
  cfg: PredictSdkConfig,
  p: { amount: bigint; sender: string },
  tx: Transaction = new Transaction(),
): Transaction {
  const plp = tx.moveCall({
    target: `${cfg.predictPackageId}::predict::supply`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      coinWithBalance({ type: cfg.dusdcType, balance: p.amount }),
      tx.object(cfg.clockId),
    ],
  });
  tx.transferObjects([plp], p.sender);
  return tx;
}

/**
 * withdraw<Quote>(predict, lp_coin, clock, ctx): Coin<Quote> — burn PLP, receive dUSDC.
 * Pulls `plpAmount` PLP from the sender's wallet; transfers the dUSDC back.
 */
export function buildWithdraw(
  cfg: PredictSdkConfig,
  p: { plpAmount: bigint; sender: string },
  tx: Transaction = new Transaction(),
): Transaction {
  const out = tx.moveCall({
    target: `${cfg.predictPackageId}::predict::withdraw`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      coinWithBalance({ type: cfg.plpType, balance: p.plpAmount }),
      tx.object(cfg.clockId),
    ],
  });
  tx.transferObjects([out], p.sender);
  return tx;
}

/** get_range_trade_amounts(predict, oracle, key, quantity, clock) -> (mint_cost, redeem_payout). */
export function buildGetRangeTradeAmounts(
  cfg: PredictSdkConfig,
  p: Pick<RangeMintParams, 'oracleId' | 'expiry' | 'lowerStrike' | 'higherStrike' | 'quantity'>,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = rangeKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::get_range_trade_amounts`,
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/** get_trade_amounts(predict, oracle, key, quantity, clock) -> (mint_cost, redeem_payout). For devInspect. */
export function buildGetTradeAmounts(
  cfg: PredictSdkConfig,
  p: Pick<MintParams, 'oracleId' | 'expiry' | 'strike' | 'isUp' | 'quantity'>,
  tx: Transaction = new Transaction(),
): Transaction {
  const key = marketKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::get_trade_amounts`,
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}

/** predict_manager::balance<T>(manager) -> u64 (spendable balance inside the manager). For devInspect. */
export function buildManagerBalance(
  cfg: PredictSdkConfig,
  managerId: string,
  coinType: string,
  tx: Transaction = new Transaction(),
): Transaction {
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict_manager::balance`,
    typeArguments: [coinType],
    arguments: [tx.object(managerId)],
  });
  return tx;
}

/** predict_manager::position(manager, key) -> u64. For devInspect. */
export function buildManagerPosition(
  cfg: PredictSdkConfig,
  managerId: string,
  f: { oracleId: string; expiry: bigint; strike: bigint; isUp: boolean },
  tx: Transaction = new Transaction(),
): Transaction {
  const key = marketKeyArg(tx, cfg, f);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict_manager::position`,
    arguments: [tx.object(managerId), key],
  });
  return tx;
}
