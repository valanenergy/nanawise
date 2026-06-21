import { randomUUID } from 'node:crypto';
import { isExpired } from '@nanawise/sui-auth';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from './clients.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerSocialCommands } from './commands/social.js';
import { registerTournamentCommands } from './commands/tournament.js';
import { registerTradingCommands } from './commands/trading.js';
import { registerVaultCommands } from './commands/vault.js';

const trunc = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * grammy bot (Phase 1). `/start` either greets a returning user or deep-links the
 * Mini App (a Telegram Web App button) for Google sign-in. State binds the login
 * back to this telegram_id; the Mini App POSTs completion to the HTTP API.
 *
 * NOTE: Web App buttons require an HTTPS Mini App URL — for local dev, expose
 * apps/web via a tunnel (cloudflared/ngrok) and set MINI_APP_URL to it.
 */
export function buildBot(deps: Deps): Bot {
  const bot = new Bot(deps.cfg.telegramBotToken);

  bot.command('start', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;

    // Referral capture: /start <refUserId> deep-link (docs/07).
    const refArg = (ctx.match ?? '').trim();
    if (refArg && /^\d+$/.test(refArg) && refArg !== String(tgId)) {
      await deps.redis.set(`ref_pending:${tgId}`, refArg, 'EX', 3600);
    }

    const sess = await deps.sessions.getSession(tgId);
    if (sess && !isExpired(sess)) {
      await ctx.reply(`Welcome back 👋  Your wallet: ${trunc(sess.suiAddress)}`);
      return;
    }

    const state = randomUUID();
    await deps.sessions.putOAuthState(state, { telegramId: String(tgId) });
    const url = `${deps.cfg.miniAppUrl}?state=${state}`;
    const kb = new InlineKeyboard().webApp('🔐 Sign in with Google', url);
    await ctx.reply(
      [
        '*Welcome to Nanawise* — trade BTC up/down on DeepBook Predict.',
        '',
        'No seed phrase. No gas. Just Google sign-in.',
        'Tap below to create your self-custodial wallet:',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '*Nanawise commands*',
        '/start — set up your wallet (Google sign-in)',
        '/market — live BTC strikes & prices',
        '/up <strike> <amount> — bet BTC ≥ strike',
        '/down <strike> <amount> — bet BTC < strike',
        '/range <low> <high> <amount> — bet BTC settles in a band',
        '/pnl · /positions — your portfolio',
        '/redeem <strike> <up|down> — early-exit a live position',
        '',
        '*Vault (earn the spread)*',
        '/vault — vault stats · /supply <amt> · /withdraw <amt>',
        '',
        '*Agent (auto-trading)*',
        '/policy <budget> <hours> — fund an agent budget',
        '/auto <strategy> | off — turn the agent on/off',
        '/revoke — stop the agent & reclaim funds',
        '',
        '*Social*',
        '/streak · /share · /leaderboard · /signal',
        '/tournament start|join|status',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  registerTradingCommands(bot, deps);
  registerVaultCommands(bot, deps);
  registerAgentCommands(bot, deps);
  registerSocialCommands(bot, deps);
  registerTournamentCommands(bot, deps);
  return bot;
}

/** Send the post-onboarding welcome DM (called by the HTTP API on completion). */
export async function notifyOnboarded(
  bot: Bot,
  telegramId: number,
  address: string,
  managerId: string | undefined,
  fundingDigest: string | undefined,
): Promise<void> {
  const lines = [
    "✅ You're in! Your self-custodial wallet is ready.",
    `Address: \`${trunc(address)}\``,
    managerId ? `Manager: \`${trunc(managerId)}\`` : '',
    fundingDigest ? `Funded 10 dUSDC — tx \`${fundingDigest.slice(0, 10)}…\`` : '',
    '',
    'Send /help to see what you can do.',
  ].filter(Boolean);
  await bot.api.sendMessage(telegramId, lines.join('\n'), { parse_mode: 'Markdown' });
}
