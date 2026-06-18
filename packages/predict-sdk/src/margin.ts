import { coinWithBalance, Transaction } from '@mysten/sui/transactions';

/**
 * DeepBook Margin dUSDC LENDING integration (Phase 6 Part B — docs/06).
 *
 * STATUS: deferred to Phase 8 (2026-06-19). The margin Move packages live on the
 * deepbook repo `main` branch (not our validated `predict-testnet-4-16`), and a
 * deployed testnet `MarginPool<DUSDC>` object ID is not published in our validated
 * sources or the `@mysten/deepbook-v3` SDK constants. Rather than fabricate IDs we
 * keep this module config-gated: once MARGIN_PACKAGE_ID + MARGIN_POOL_ID are
 * confirmed, the builders below activate with no further code (signatures per the
 * deepbook-margin `margin_pool` module: supply/withdraw with a SupplierCap).
 *
 * Pure lending (supply side) is Pyth-independent; only borrow/liquidation needs Pyth.
 */
export interface MarginConfig {
  marginPackageId?: string;
  marginPoolId?: string; // MarginPool<DUSDC> shared object
  dusdcType: string;
}

export function marginEnabled(cfg: MarginConfig): boolean {
  return Boolean(cfg.marginPackageId && cfg.marginPoolId);
}

function require_(cfg: MarginConfig): { pkg: string; pool: string } {
  if (!cfg.marginPackageId || !cfg.marginPoolId) {
    throw new Error('Margin lending not configured (set MARGIN_PACKAGE_ID + MARGIN_POOL_ID) — deferred to Phase 8');
  }
  return { pkg: cfg.marginPackageId, pool: cfg.marginPoolId };
}

/** supply<DUSDC>(pool, coin, clock, ctx): SupplierCap — lend dUSDC, receive a SupplierCap. */
export function buildMarginSupply(
  cfg: MarginConfig,
  p: { amount: bigint; sender: string; clockId: string },
  tx: Transaction = new Transaction(),
): Transaction {
  const { pkg, pool } = require_(cfg);
  const cap = tx.moveCall({
    target: `${pkg}::margin_pool::supply`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(pool), coinWithBalance({ type: cfg.dusdcType, balance: p.amount }), tx.object(p.clockId)],
  });
  tx.transferObjects([cap], p.sender);
  return tx;
}

/** withdraw<DUSDC>(pool, supplier_cap, amount, clock, ctx): Coin<DUSDC>. */
export function buildMarginWithdraw(
  cfg: MarginConfig,
  p: { supplierCapId: string; amount: bigint; sender: string; clockId: string },
  tx: Transaction = new Transaction(),
): Transaction {
  const { pkg, pool } = require_(cfg);
  const out = tx.moveCall({
    target: `${pkg}::margin_pool::withdraw`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(pool), tx.object(p.supplierCapId), tx.pure.u64(p.amount), tx.object(p.clockId)],
  });
  tx.transferObjects([out], p.sender);
  return tx;
}
