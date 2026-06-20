import { prisma } from '@nanawise/db';
import { isExpired } from '@nanawise/sui-auth';
import { formatUsdc, parseUsdc } from '@nanawise/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from '../clients.js';

/**
 * Group tournaments (Phase 7). Escrow = the custom `tournament` Move object (a
 * PredictManager can't take third-party deposits). The bot/keeper is the admin that
 * settles. `/tournament start|join|status`.
 *
 * The create + payout TXs are admin-signed by the keeper (when its key is present);
 * `join` is entrant-signed via the Mini App. Ranking is computed by the keeper from
 * settled events (this module handles the chat UX + escrow wiring).
 */
const PLATFORM_FEE_BPS = 250; // 2.5%

export function registerTournamentCommands(bot: Bot, deps: Deps): void {
  async function requireSession(tgId: number) {
    const s = await deps.sessions.getSession(tgId);
    return s && !isExpired(s) ? s : null;
  }

  bot.command('tournament', async (ctx) => {
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (sub === 'start') {
      const hours = Number(parts[1]);
      let entryFee: bigint;
      try {
        entryFee = parseUsdc(parts[2] ?? '');
      } catch {
        await ctx.reply('Usage: /tournament start <hours> <entryFee>\nExample: /tournament start 24 5');
        return;
      }
      if (!Number.isFinite(hours) || hours <= 0) {
        await ctx.reply('Hours must be positive.');
        return;
      }
      if (!deps.cfg.predict.tournamentPackageId) {
        await ctx.reply('Tournaments are not configured on this deployment yet.');
        return;
      }
      // Ensure the Group row exists; the keeper creates the on-chain escrow (admin).
      await prisma.group.upsert({
        where: { chatId: BigInt(chatId) },
        create: { chatId: BigInt(chatId), name: ctx.chat?.title ?? null },
        update: {},
      });
      await deps.redis.set(
        `tournament_pending:${chatId}`,
        JSON.stringify({ hours, entryFee: entryFee.toString(), platformFeeBps: PLATFORM_FEE_BPS }),
        'EX',
        600,
      );
      await ctx.reply(
        [
          `🏁 *Tournament queued* — entry ${formatUsdc(entryFee)} dUSDC, runs ${hours}h.`,
          'The keeper will create the on-chain prize escrow. Members: /tournament join to enter.',
          '_Prize pool = entries − 2.5% platform fee, paid to the top trader at the end._',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (sub === 'join') {
      const tgId = ctx.from?.id;
      if (!tgId) return;
      const sess = await requireSession(tgId);
      if (!sess) {
        await ctx.reply('Tap /start to set up your wallet first.');
        return;
      }
      const t = await prisma.tournament.findFirst({
        where: { groupChatId: BigInt(chatId), status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      if (!t) {
        await ctx.reply('No active tournament in this group. Start one with /tournament start.');
        return;
      }
      const kb = new InlineKeyboard().webApp(
        `Pay ${formatUsdc(t.entryFee)} dUSDC & join →`,
        `${deps.cfg.miniAppUrl}/miniapp/tournament?action=join&id=${t.escrowObjectId}&fee=${t.entryFee}`,
      );
      await ctx.reply(`Join the tournament for ${formatUsdc(t.entryFee)} dUSDC?`, { reply_markup: kb });
      return;
    }

    if (sub === 'status') {
      const t = await prisma.tournament.findFirst({
        where: { groupChatId: BigInt(chatId) },
        orderBy: { createdAt: 'desc' },
      });
      if (!t) {
        await ctx.reply('No tournament in this group yet.');
        return;
      }
      const lines = [
        `🏆 Tournament — *${t.status}*`,
        `Entry: ${formatUsdc(t.entryFee)} dUSDC · Pool: ${formatUsdc(t.prizePool)} dUSDC`,
        `Ends: ${t.endTime.toISOString()}`,
      ];
      if (t.winnerUserId) lines.push(`Winner: ${t.winnerUserId}`);
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply('Usage: /tournament start <hours> <fee> · /tournament join · /tournament status');
  });
}
