import { prisma } from '@nanawise/db';
import { Transaction } from '@mysten/sui/transactions';
import type { KeeperDeps } from './clients.js';
import { notifySettlement } from './notifier.js';

const BATCH = 20; // max redeem_permissionless calls per PTB (gas cap, docs/03 §9)

/** Deterministic non-null dedupe key for a binary redemption (H1). */
function binaryKey(managerId: string, oracleId: string, strike: bigint, isUp: boolean): string {
  return `bin|${managerId}|${oracleId}|${strike}|${isUp ? 0 : 1}`;
}

/**
 * On OracleSettled: auto-redeem every unredeemed BINARY position via
 * redeem_permissionless (keeper gas; payout lands in the OWNER's manager — no sender
 * check). Ranges have no permissionless path, so they get a "tap to claim" DM.
 *
 * Idempotent via the Redemption ledger's unique constraint: a row is inserted per
 * settled position; a restart re-queries and skips already-recorded ones.
 */
export async function settleOracle(deps: KeeperDeps, oracleId: string): Promise<void> {
  if (!deps.keeper) {
    console.warn('[redeemer] no keeper key — cannot redeem; skipping', oracleId);
    return;
  }
  const positions = await deps.predict.unredeemedBinaries(oracleId);
  // Skip the agent's own manager (Phase 4 sweeps it via return_funds).
  const filtered = positions.filter((p) => p.managerId !== deps.cfg.agentManagerId);

  // Drop ones we've already recorded (idempotency) via the deterministic redemptionKey.
  const fresh = [];
  for (const p of filtered) {
    const exists = await prisma.redemption.findUnique({
      where: { redemptionKey: binaryKey(p.managerId, oracleId, p.strike, p.isUp) },
    });
    if (!exists) fresh.push(p);
  }
  if (fresh.length === 0) {
    console.log(`[redeemer] ${oracleId}: nothing to settle`);
  }

  for (let i = 0; i < fresh.length; i += BATCH) {
    const chunk = fresh.slice(i, i + BATCH);
    const tx = new Transaction();
    for (const p of chunk) {
      deps.predict.buildRedeemPermissionless(
        { managerId: p.managerId, oracleId, expiry: p.expiry, strike: p.strike, isUp: p.isUp, quantity: p.quantity },
        tx,
      );
    }
    try {
      const res = await deps.sui.signAndExecuteTransaction({
        signer: deps.keeper,
        transaction: tx,
        options: { showEffects: true },
      });
      await deps.sui.waitForTransaction({ digest: res.digest });
      console.log(`[redeemer] ${oracleId}: settled ${chunk.length} positions in ${res.digest.slice(0, 10)}…`);

      // Read back payouts from the redeem events (authoritative) and record + notify.
      const redeemed = await deps.predict.getPositionsRedeemed({ oracle_id: oracleId });
      for (const p of chunk) {
        const ev = redeemed.find(
          (r) => r.managerId === p.managerId && r.strike === p.strike && r.isUp === p.isUp,
        );
        const payout = ev?.payout ?? 0n;
        await recordAndNotify(deps, oracleId, p, payout, ev?.digest ?? res.digest);
      }
    } catch (e) {
      console.error(`[redeemer] batch failed for ${oracleId}:`, (e as Error).message);
    }
  }

  // Ranges: notify owners to claim (owner-gated redeem_range).
  await notifyRangeClaims(deps, oracleId);
}

async function recordAndNotify(
  deps: KeeperDeps,
  oracleId: string,
  p: { managerId: string; owner: string; strike: bigint; isUp: boolean; quantity: bigint },
  payout: bigint,
  txHash: string,
): Promise<void> {
  try {
    await prisma.redemption.create({
      data: {
        redemptionKey: binaryKey(p.managerId, oracleId, p.strike, p.isUp),
        managerId: p.managerId,
        ownerAddress: p.owner,
        oracleId,
        isRange: false,
        strike: p.strike,
        direction: p.isUp ? 0 : 1,
        quantity: p.quantity,
        payout,
        txHash,
      },
    });
  } catch {
    // unique-constraint violation on redemptionKey = already recorded → idempotent no-op
    return;
  }
  await notifySettlement(deps, { ownerAddress: p.owner, oracleId, strike: p.strike, isUp: p.isUp, payout });
}

async function notifyRangeClaims(deps: KeeperDeps, oracleId: string): Promise<void> {
  const ranges = await deps.predict.getRangesMinted({ oracle_id: oracleId });
  for (const r of ranges) {
    if (r.managerId === deps.cfg.agentManagerId) continue;
    const user = await prisma.user.findFirst({ where: { suiAddress: r.trader } });
    if (!user) continue;
    await deps.queue.add('range-claim', {
      telegramId: user.telegramId.toString(),
      result: 'range-claim',
      oracleId,
      lowerStrike: r.lowerStrike.toString(),
      higherStrike: r.higherStrike.toString(),
    });
  }
}
