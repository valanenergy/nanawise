import { prisma } from '@nanawise/db';
import type { KeeperDeps } from './clients.js';

/**
 * Settlement notifier (Phase 3). The keeper is the SOLE writer of Streak and the
 * settlement DM jobs (docs/05) — one streak update per (user, oracle) to avoid
 * double-counting across batches. Payout is read from the redeem event (verified).
 */
export interface SettlementInput {
  ownerAddress: string;
  oracleId: string;
  strike: bigint;
  isUp: boolean;
  payout: bigint;
}

export async function notifySettlement(deps: KeeperDeps, s: SettlementInput): Promise<void> {
  const user = await prisma.user.findFirst({ where: { suiAddress: s.ownerAddress } });
  if (!user) return; // not one of our users (e.g. external trader)

  const won = s.payout > 0n;

  // One streak event per (user, oracle): dedupe via a Redis NX marker.
  const streakKey = `streak_applied:${user.id}:${s.oracleId}`;
  const firstForOracle = (await deps.redis.set(streakKey, '1', 'EX', 86400, 'NX')) === 'OK';
  if (firstForOracle) {
    await updateStreak(user.id, won);
  }

  await deps.queue.add('settlement', {
    telegramId: user.telegramId.toString(),
    result: won ? 'won' : 'lost',
    payout: s.payout.toString(),
    strike: s.strike.toString(),
    direction: s.isUp ? 'up' : 'down',
    oracleId: s.oracleId,
  });
}

async function updateStreak(userId: string, won: boolean): Promise<void> {
  const existing = await prisma.streak.findUnique({ where: { userId } });
  if (!existing) {
    await prisma.streak.create({
      data: {
        userId,
        current: won ? 1 : 0,
        longest: won ? 1 : 0,
        lastWinDate: won ? new Date() : null,
        totalTrades: 1,
        totalWins: won ? 1 : 0,
      },
    });
    return;
  }
  const current = won ? existing.current + 1 : 0;
  await prisma.streak.update({
    where: { userId },
    data: {
      current,
      longest: Math.max(existing.longest, current),
      lastWinDate: won ? new Date() : existing.lastWinDate,
      totalTrades: existing.totalTrades + 1,
      totalWins: existing.totalWins + (won ? 1 : 0),
    },
  });
}
