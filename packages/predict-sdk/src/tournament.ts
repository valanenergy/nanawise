import { coinWithBalance, Transaction } from '@mysten/sui/transactions';

/**
 * tournament Move builders (Phase 7, docs/07). Config-gated on TOURNAMENT_PACKAGE_ID.
 * The escrow holds entry fees and an admin (bot/keeper) releases the pool to the
 * winner — the DeFi-track "conditional payments" object.
 */
export interface TournamentConfig {
  tournamentPackageId?: string;
  dusdcType: string;
  clockId: string;
}

function require_(cfg: TournamentConfig): string {
  if (!cfg.tournamentPackageId) throw new Error('TOURNAMENT_PACKAGE_ID not configured');
  return cfg.tournamentPackageId;
}

/** create<DUSDC>(entry_fee, platform_fee_bps, start_ms, end_ms) — signed by the bot/keeper admin. */
export function buildCreateTournament(
  cfg: TournamentConfig,
  p: { entryFee: bigint; platformFeeBps: number; startMs: bigint; endMs: bigint },
  tx: Transaction = new Transaction(),
): Transaction {
  const pkg = require_(cfg);
  tx.moveCall({
    target: `${pkg}::tournament::create`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.pure.u64(p.entryFee),
      tx.pure.u64(BigInt(p.platformFeeBps)),
      tx.pure.u64(p.startMs),
      tx.pure.u64(p.endMs),
    ],
  });
  return tx;
}

/** join<DUSDC>(tournament, fee, now_ms) — signed by the entrant. */
export function buildJoinTournament(
  cfg: TournamentConfig,
  p: { tournamentId: string; entryFee: bigint; nowMs: bigint },
  tx: Transaction = new Transaction(),
): Transaction {
  const pkg = require_(cfg);
  tx.moveCall({
    target: `${pkg}::tournament::join`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(p.tournamentId),
      coinWithBalance({ type: cfg.dusdcType, balance: p.entryFee }),
      tx.pure.u64(p.nowMs),
    ],
  });
  return tx;
}

/** payout<DUSDC>(tournament, winner) → returns the platform-fee coin; admin transfers it. */
export function buildPayoutTournament(
  cfg: TournamentConfig,
  p: { tournamentId: string; winner: string; adminAddress: string; nowMs: bigint },
  tx: Transaction = new Transaction(),
): Transaction {
  const pkg = require_(cfg);
  const fee = tx.moveCall({
    target: `${pkg}::tournament::payout`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.tournamentId), tx.pure.address(p.winner), tx.pure.u64(p.nowMs)],
  });
  tx.transferObjects([fee], p.adminAddress);
  return tx;
}
