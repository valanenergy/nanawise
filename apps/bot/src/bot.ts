import { randomUUID } from 'node:crypto';
import { isExpired } from '@nanawise/sui-auth';
import { formatStrike, formatUsdc } from '@nanawise/shared';
import { Bot, InlineKeyboard } from 'grammy';
import { runAgent, type AgentResult } from './ai/agent.js';
import { transcribeAudio } from './ai/openai.js';
import type { Deps } from './clients.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerFaucetCommand } from './commands/faucet.js';
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


  bot.catch((err) => {
    console.error('[bot] error:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[bot] unhandled rejection:', reason);
  });

  bot.use(async (ctx, next) => {
    console.log('[bot] middleware processing:', ctx.message?.text);
    await next();
  });

  bot.command('start', async (ctx) => {
    try {
      console.log('[bot] /start command from', ctx.from?.id);
      const tgId = ctx.from?.id;
      if (!tgId) return;

      // Referral capture: /start <refUserId> deep-link (docs/07).
      const refArg = (ctx.match ?? '').trim();
      if (refArg && /^\d+$/.test(refArg) && refArg !== String(tgId)) {
        await deps.redis.set(`ref_pending:${tgId}`, refArg, 'EX', 3600);
      }

      const sess = await deps.sessions.getSession(tgId);
      if (sess && !isExpired(sess)) {
        // Still hand back an "open app" button (with a fresh OAuth state) so the user
        // can reach the Mini App — to continue trading OR to sign out / switch account.
        const state = randomUUID();
        await deps.sessions.putOAuthState(state, { telegramId: String(tgId) });
        const kb = new InlineKeyboard().webApp('Open Nanawise', `${deps.cfg.miniAppUrl}/app?state=${state}`);
        await ctx.reply(`Welcome back 👋  Your wallet: ${trunc(sess.suiAddress)}`, { reply_markup: kb });
        return;
      }

      const state = randomUUID();
      await deps.sessions.putOAuthState(state, { telegramId: String(tgId) });
      const url = `${deps.cfg.miniAppUrl}/app?state=${state}`;
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
      console.log('[bot] /start reply sent to', tgId);
    } catch (err) {
      console.error('[bot] /start error:', err);
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '*Just talk to me* 💬',
        'Type or send a voice note like “bet $2 BTC goes up” or “I think bitcoin stays above 64k” — I’ll read the market, pick the position, and give you a one-tap pay button with the reasoning.',
        '',
        '*Nanawise commands*',
        '/start — set up your wallet (Google sign-in)',
        '/market — live BTC strikes & prices (tap 📈/📉 to trade)',
        '/up <strike> <amount> — bet BTC ≥ strike',
        '/down <strike> <amount> — bet BTC < strike',
        '/range <low> <high> <amount> — bet BTC settles in a band',
        '/pnl · /positions — your portfolio',
        '/redeem <strike> <up|down> — early-exit a live position',
        '/faucet [usdc] [sui] — testnet: top up your wallet',
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
  registerFaucetCommand(bot, deps);
  registerVaultCommands(bot, deps);
  registerAgentCommands(bot, deps);
  registerSocialCommands(bot, deps);
  registerTournamentCommands(bot, deps);

  // ── AI assistant: free-text + voice → position with click-to-pay ───────────────
  // Registered AFTER commands so slash-commands win (their handlers don't call
  // next(), so these only fire for non-command messages).
  registerAiHandlers(bot, deps);

  return bot;
}

/** Render an agent result: plain answer, or an explanation + one-tap pay button. */
async function sendAgentReply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  deps: Deps,
  result: AgentResult,
): Promise<void> {
  if (!result.trade) {
    await ctx.reply(result.text);
    return;
  }
  const t = result.trade;
  const url =
    `${deps.cfg.miniAppUrl}/miniapp/trade?action=mint` +
    `&oracleId=${t.oracleId}&expiry=${t.expiryMs}&strike=${t.strike1e9}&isUp=${t.isUp}&quantity=${t.quantity}`;
  const kb = new InlineKeyboard().webApp(`💸 Open — pay ${formatUsdc(t.cost)} dUSDC`, url);
  const mins = Math.max(0, Math.round((t.expiryMs - Date.now()) / 60000));
  const text = [
    result.text,
    '',
    `*${t.isUp ? '📈 UP' : '📉 DOWN'} $${formatStrike(t.strike1e9)}* · ${formatUsdc(t.quantity)} contracts`,
    `Cost *${formatUsdc(t.cost)} dUSDC* · max payout *${formatUsdc(t.payout)}* · ${Math.round(t.prob * 100)}% implied · ~${mins}m left`,
  ].join('\n');
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

/** Wire the natural-language (text) and voice handlers. */
function registerAiHandlers(bot: Bot, deps: Deps): void {
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';
    if (text.startsWith('/')) return; // stray/unknown command — not for the AI
    try {
      await ctx.replyWithChatAction('typing');
      const sess = await deps.sessions.getSession(ctx.from?.id ?? 0);
      const result = await runAgent(deps, sess?.suiAddress, text);
      await sendAgentReply(ctx, deps, result);
    } catch (e) {
      console.error('[ai] text error:', e);
      await ctx.reply('Sorry — I hit a snag understanding that. Try again, or use /market.');
    }
  });

  bot.on('message:voice', async (ctx) => {
    if (!deps.cfg.openaiApiKey) {
      await ctx.reply('Voice needs the AI assistant configured.');
      return;
    }
    try {
      await ctx.replyWithChatAction('typing');
      // Download the Telegram voice file (ogg/opus) and transcribe it.
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${deps.cfg.telegramBotToken}/${file.file_path}`;
      const audio = new Uint8Array(await (await fetch(fileUrl)).arrayBuffer());
      const transcript = await transcribeAudio(deps.cfg.openaiApiKey, audio);
      if (!transcript.trim()) {
        await ctx.reply("I couldn't hear that clearly — mind sending it again?");
        return;
      }
      await ctx.reply(`🎙️ _“${transcript.trim()}”_`, { parse_mode: 'Markdown' });
      const sess = await deps.sessions.getSession(ctx.from?.id ?? 0);
      const result = await runAgent(deps, sess?.suiAddress, transcript);
      await sendAgentReply(ctx, deps, result);
    } catch (e) {
      console.error('[ai] voice error:', e);
      await ctx.reply('Sorry — I had trouble with that voice note. Try again or type it.');
    }
  });
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
