import { prisma } from '@nanawise/db';
import { isExpired } from '@nanawise/sui-auth';
import { formatUsdc, streakBadge } from '@nanawise/shared';
import { Bot, InputFile } from 'grammy';
import type { Deps } from '../clients.js';
import { renderPnlCard } from './card.js';

/**
 * Social & gamification commands (Phase 7): /streak, /share (PnL card), /leaderboard,
 * /signal (Polymarket vs ours), and referral capture (handled in /start).
 */
export function registerSocialCommands(bot: Bot, deps: Deps): void {
  async function session(tgId: number) {
    const s = await deps.sessions.getSession(tgId);
    return s && !isExpired(s) ? s : null;
  }

  bot.command('streak', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) }, include: { streak: true } });
    const s = user?.streak;
    if (!s || s.totalTrades === 0) {
      await ctx.reply('No streak yet — settle a winning trade to start one. 🔥');
      return;
    }
    await ctx.reply(
      [
        `${streakBadge(s.current)} *Current streak: ${s.current}*`,
        `Longest: ${s.longest}`,
        `Record: ${s.totalWins}/${s.totalTrades} won (${((s.totalWins / s.totalTrades) * 100).toFixed(0)}%)`,
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('share', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await session(tgId);
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) }, include: { streak: true } });
    if (!sess?.managerId || !user) {
      await ctx.reply('Trade first, then /share your card.');
      return;
    }
    let totalPnl = 0;
    try {
      const pnl = await deps.predict.getManagerPnl(sess.managerId);
      totalPnl = Number(pnl.total) / 1e6;
    } catch {
      /* default 0 */
    }
    let btc = 0;
    try {
      const cached = await deps.redis.get('oracle:active');
      if (cached) btc = Number(JSON.parse(cached).spot) / 1e9;
    } catch {
      /* ignore */
    }
    const s = user.streak;
    const winRate = s && s.totalTrades > 0 ? s.totalWins / s.totalTrades : 0;
    try {
      const png = await renderPnlCard({
        handle: ctx.from?.username ?? `trader${tgId}`,
        totalPnl,
        winRate,
        streak: s?.current ?? 0,
        btcPrice: btc || 0,
        profileUrl: `${deps.cfg.miniAppUrl}/u/${tgId}`,
      });
      await ctx.replyWithPhoto(new InputFile(png, 'nanawise.png'), {
        caption: 'My Nanawise card — trade BTC up/down, no gas. 📈',
      });
    } catch (e) {
      await ctx.reply(`Card render failed: ${(e as Error).message}`);
    }
  });

  bot.command('leaderboard', async (ctx) => {
    // Global realized PnL = settled payout − mint cost (chain truth). H4: net, not gross.
    const [redeemed, minted] = await Promise.all([
      deps.predict.getPositionsRedeemed().catch(() => []),
      deps.predict.getPositionsMinted().catch(() => []),
    ]);
    const costByMgr = new Map<string, bigint>();
    for (const m of minted) costByMgr.set(m.managerId, (costByMgr.get(m.managerId) ?? 0n) + m.cost);
    const byOwner = new Map<string, { realized: bigint; wins: number; trades: number; mgr: string }>();
    for (const r of redeemed) {
      const cur = byOwner.get(r.owner) ?? { realized: 0n, wins: 0, trades: 0, mgr: r.managerId };
      cur.realized += r.payout;
      cur.trades += 1;
      if (r.payout > 0n) cur.wins += 1;
      byOwner.set(r.owner, cur);
    }
    // subtract each owner's manager mint-cost to get net realized PnL
    for (const v of byOwner.values()) v.realized -= costByMgr.get(v.mgr) ?? 0n;
    const top = [...byOwner.entries()].sort((a, b) => Number(b[1].realized - a[1].realized)).slice(0, 10);
    if (top.length === 0) {
      await ctx.reply('No settled trades on the board yet.');
      return;
    }
    const lines = top.map(
      ([owner, s], i) => `${i + 1}. ${owner.slice(0, 6)}…${owner.slice(-4)} — ${formatUsdc(s.realized)} (${s.wins}/${s.trades})`,
    );
    await ctx.reply(['🏆 *Global leaderboard*', ...lines].join('\n'), { parse_mode: 'Markdown' });
  });

  // Copy-trading consent (Phase 7). Target opts into being copied; follower opts to copy.
  bot.command('copyallow', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const me = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!me) {
      await ctx.reply('Tap /start first.');
      return;
    }
    // mark consent on any existing follow rows targeting me + a flag for future ones
    await deps.redis.set(`copy_consent:${me.id}`, '1');
    await prisma.copyTrade.updateMany({ where: { targetId: me.id }, data: { consent: true } });
    await ctx.reply('✅ Others can now copy your trades. Share your referral link to grow followers.');
  });

  bot.command('copy', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const me = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!me) {
      await ctx.reply('Tap /start first.');
      return;
    }
    const targetTg = (ctx.match ?? '').trim();
    if (!/^\d+$/.test(targetTg)) {
      await ctx.reply('Usage: /copy <traderTelegramId> — mirror a trader (you confirm each trade).');
      return;
    }
    const target = await prisma.user.findUnique({ where: { telegramId: BigInt(targetTg) } });
    if (!target) {
      await ctx.reply('That trader is not on Nanawise yet.');
      return;
    }
    const consented = (await deps.redis.get(`copy_consent:${target.id}`)) === '1';
    await prisma.copyTrade.upsert({
      where: { followerId_targetId: { followerId: me.id, targetId: target.id } },
      create: { followerId: me.id, targetId: target.id, active: true, consent: consented },
      update: { active: true, consent: consented },
    });
    await ctx.reply(
      consented
        ? "👯 You're now copying that trader (confirm mode — you sign each mirrored trade)."
        : 'Follow saved, but that trader has not enabled copying yet (/copyallow on their side).',
    );
  });

  bot.command('signal', async (ctx) => {
    const cached = await deps.redis.get('signal:latest');
    if (!cached) {
      await ctx.reply('No cross-venue signal yet — the keeper refreshes it every few minutes.');
      return;
    }
    const s = JSON.parse(cached) as { ours: number; polymarket: number; spread: number; strike?: number };
    await ctx.reply(
      [
        '📡 *BTC-up signal — Nanawise vs Polymarket*',
        `Ours: ${(s.ours * 100).toFixed(1)}%`,
        `Polymarket: ${(s.polymarket * 100).toFixed(1)}%`,
        `Spread: ${(s.spread * 100).toFixed(1)}pp`,
        '',
        '_Imperfect comparison (different expiries) — informational, not guaranteed arbitrage._',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });
}
