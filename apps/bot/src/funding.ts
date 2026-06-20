import { prisma } from '@nanawise/db';
import { coinWithBalance, Transaction } from '@mysten/sui/transactions';
import type { Deps } from './clients.js';

/** Onboarding grant: 100 dUSDC (6 decimals). */
export const FUND_AMOUNT = 100_000_000n;

/**
 * Hot-wallet onboarding funding.
 *
 * CORRECTION (vs. phase-1 doc): `predict_manager::deposit` is owner-gated (sender
 * must be the manager owner), so the hot wallet CANNOT deposit into the user's
 * manager. The hot wallet instead transfers dUSDC to the user's ADDRESS; the
 * user-signed (sponsored) onboarding PTB then runs create_manager + deposit. So
 * onboarding ends with dUSDC inside the manager via a USER-signed deposit, not here.
 *
 * Idempotent: guarded by User.funded + a Redis funding_lock NX key so retries /
 * double-onboarding never double-fund (docs/05, Phase 1 CC).
 */
export async function fundNewUserAddress(
  deps: Deps,
  telegramId: number | bigint,
  suiAddress: string,
): Promise<{ digest?: string; skipped?: string }> {
  if (!deps.hotWallet) return { skipped: 'no hot wallet configured' };

  const tgId = BigInt(telegramId);
  const existing = await prisma.user.findUnique({ where: { telegramId: tgId } });
  if (existing?.funded) return { skipped: 'already funded', digest: existing.fundedTxDigest ?? undefined };

  // Idempotency keyed consistently on telegramId (lock + the User.funded flag).
  const lockKey = `funding_lock:${tgId}`;
  const lock = await deps.redis.set(lockKey, '1', 'EX', 120, 'NX');
  if (lock !== 'OK') return { skipped: 'funding in progress' };

  try {
    const tx = new Transaction();
    const coin = coinWithBalance({ type: deps.cfg.predict.dusdcType, balance: FUND_AMOUNT });
    tx.transferObjects([coin], suiAddress);
    const res = await deps.sui.signAndExecuteTransaction({
      signer: deps.hotWallet,
      transaction: tx,
      options: { showEffects: true },
    });
    await deps.sui.waitForTransaction({ digest: res.digest });
    await prisma.user.update({
      where: { telegramId: tgId },
      data: { funded: true, fundedTxDigest: res.digest },
    });
    return { digest: res.digest };
  } catch (e) {
    // Don't fail onboarding if the grant can't be sent (e.g. hot wallet dry).
    return { skipped: `funding failed: ${(e as Error).message}` };
  } finally {
    await deps.redis.del(lockKey);
  }
}
