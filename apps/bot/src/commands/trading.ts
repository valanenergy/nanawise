import { TradeError } from '@nanawise/predict-sdk';
import { isExpired } from '@nanawise/sui-auth';
import { formatUsdc, OracleStatus, parseUsdc } from '@nanawise/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from '../clients.js';
import { renderMarket, timeToExpiry } from './format.js';

/**
 * Phase 2 trading commands. Reads run inline in chat; state-changing actions
 * (mint/redeem/range) deep-link the Mini App trade screen to confirm + sign with
 * the client-held key (docs/02 custody). Here we validate, preview, and hand off.
 */

const trunc = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Pick the nearest ACTIVE BTC oracle for quick replies (cached briefly in Redis). */
async function activeBtcOracle(deps: Deps) {
  const cached = await deps.redis.get('oracle:active');
  if (cached) {
    const { oracleId } = JSON.parse(cached) as { oracleId: string };
    const st = await deps.predict.getOracleState(oracleId);
    if (st.status === OracleStatus.ACTIVE) return st;
  }
  const now = Date.now();
  const oracles = await deps.predict.getOracles();
  const btc = oracles
    .filter((o) => /btc/i.test(o.underlyingAsset ?? '') && (o.expiryMs ?? 0) > now)
    .sort((a, b) => (a.expiryMs ?? 0) - (b.expiryMs ?? 0));
  for (const o of btc.slice(0, 8)) {
    const st = await deps.predict.getOracleState(o.oracleId);
    if (st.status === OracleStatus.ACTIVE) {
      await deps.redis.set(
        'oracle:active',
        JSON.stringify({ oracleId: o.oracleId, expiry: st.expiryMs, spot: st.spot1e9.toString() }),
        'EX',
        30,
      );
      return st;
    }
  }
  return undefined;
}

/** Build a Mini App deep-link button for a state-changing trade. */
function tradeButton(deps: Deps, label: string, params: Record<string, string>): InlineKeyboard {
  const qs = new URLSearchParams(params).toString();
  return new InlineKeyboard().webApp(label, `${deps.cfg.miniAppUrl}/miniapp/trade?${qs}`);
}

export function registerTradingCommands(bot: Bot, deps: Deps): void {
  /** Resolve the caller's onboarded session or prompt onboarding. */
  async function requireSession(tgId: number) {
    const sess = await deps.sessions.getSession(tgId);
    if (!sess || isExpired(sess)) return null;
    return sess;
  }

  bot.command('market', async (ctx) => {
    const o = await activeBtcOracle(deps);
    if (!o) {
      await ctx.reply('No BTC market is open right now — a new round activates shortly. Try again in a minute.');
      return;
    }
    const sender = (await deps.sessions.getSession(ctx.from?.id ?? 0))?.suiAddress ?? `0x${'0'.repeat(64)}`;
    const text = await renderMarket(deps.predict, o, sender);
    const kb = new InlineKeyboard()
      .webApp('Trade →', `${deps.cfg.miniAppUrl}/miniapp/trade?oracleId=${o.oracleId}`)
      .text('🔄 Refresh', 'market:refresh');
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  });

  // /up <strike> <amount>  and  /down <strike> <amount>
  for (const dir of ['up', 'down'] as const) {
    bot.command(dir, async (ctx) => {
      const tgId = ctx.from?.id;
      if (!tgId) return;
      const sess = await requireSession(tgId);
      if (!sess) {
        await ctx.reply('Tap /start to set up your wallet first.');
        return;
      }
      const [strikeStr, amountStr] = (ctx.match ?? '').trim().split(/\s+/);
      if (!strikeStr || !amountStr) {
        await ctx.reply(`Usage: /${dir} <strike> <amount>\nExample: /${dir} 62500 10`);
        return;
      }
      let strike1e9: bigint, quantity: bigint;
      try {
        strike1e9 = BigInt(Math.round(Number(strikeStr.replace(/[$,]/g, '')))) * 1_000_000_000n;
        quantity = parseUsdc(amountStr); // $ face value → 1e6 quantity (1 contract = $1)
      } catch {
        await ctx.reply('Could not read the strike or amount. Example: /up 62500 10');
        return;
      }
      const o = await activeBtcOracle(deps);
      if (!o) {
        await ctx.reply('No BTC market is open right now — try again shortly.');
        return;
      }
      try {
        deps.predict.assertTradable(o);
        const pv = await deps.predict.previewMint(
          { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike: strike1e9, isUp: dir === 'up', quantity },
          sess.suiAddress,
        );
        const kb = tradeButton(deps, `Confirm & sign — pay ${formatUsdc(pv.cost)} dUSDC`, {
          action: 'mint',
          oracleId: o.oracleId,
          expiry: String(o.expiryMs),
          strike: strike1e9.toString(),
          isUp: String(dir === 'up'),
          quantity: quantity.toString(),
        });
        await ctx.reply(
          [
            `*${dir.toUpperCase()} $${strikeStr}* · ${formatUsdc(quantity)} contracts`,
            `Cost ≈ *${formatUsdc(pv.cost)} dUSDC* · max payout *${formatUsdc(pv.payout)}*`,
            `Implied prob ${(pv.impliedProb * 100).toFixed(1)}% · expires in ${timeToExpiry(o.expiryMs)}`,
          ].join('\n'),
          { parse_mode: 'Markdown', reply_markup: kb },
        );
      } catch (e) {
        const msg = e instanceof TradeError ? e.message : deps.predict.mapExecutionError((e as Error).message);
        await ctx.reply(msg);
      }
    });
  }

  bot.command('range', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    const [lowStr, highStr, amountStr] = (ctx.match ?? '').trim().split(/\s+/);
    if (!lowStr || !highStr || !amountStr) {
      await ctx.reply('Usage: /range <low> <high> <amount>\nExample: /range 61000 64000 10');
      return;
    }
    let low: bigint, high: bigint, quantity: bigint;
    try {
      low = BigInt(Math.round(Number(lowStr.replace(/[$,]/g, '')))) * 1_000_000_000n;
      high = BigInt(Math.round(Number(highStr.replace(/[$,]/g, '')))) * 1_000_000_000n;
      quantity = parseUsdc(amountStr);
    } catch {
      await ctx.reply('Could not read those numbers. Example: /range 61000 64000 10');
      return;
    }
    if (low >= high) {
      await ctx.reply('The low strike must be below the high strike.');
      return;
    }
    const o = await activeBtcOracle(deps);
    if (!o) {
      await ctx.reply('No BTC market is open right now — try again shortly.');
      return;
    }
    try {
      deps.predict.assertTradable(o);
      const pv = await deps.predict.previewMintRange(
        { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), lowerStrike: low, higherStrike: high, quantity },
        sess.suiAddress,
      );
      const kb = tradeButton(deps, `Confirm & sign — pay ${formatUsdc(pv.cost)} dUSDC`, {
        action: 'mintRange',
        oracleId: o.oracleId,
        expiry: String(o.expiryMs),
        lowerStrike: low.toString(),
        higherStrike: high.toString(),
        quantity: quantity.toString(),
      });
      await ctx.reply(
        [
          `*RANGE $${lowStr}–$${highStr}* · ${formatUsdc(quantity)} contracts`,
          `Cost ≈ *${formatUsdc(pv.cost)} dUSDC* · max payout *${formatUsdc(pv.payout)}*`,
          `Wins if BTC settles inside the band · expires in ${timeToExpiry(o.expiryMs)}`,
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: kb },
      );
    } catch (e) {
      const msg = e instanceof TradeError ? e.message : deps.predict.mapExecutionError((e as Error).message);
      await ctx.reply(msg);
    }
  });

  bot.command(['pnl', 'positions'], async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess?.managerId) {
      await ctx.reply('No positions yet. /market to see what is open, then /up or /down to trade.');
      return;
    }
    // Server-side position/PnL reads land with the predict-server wrappers (Phase 2/5);
    // for now point users at the dashboard view of their manager.
    const kb = new InlineKeyboard().webApp('Open portfolio →', `${deps.cfg.miniAppUrl}/portfolio`);
    await ctx.reply(`Your wallet: ${trunc(sess.suiAddress)}\nManager: ${trunc(sess.managerId)}`, {
      reply_markup: kb,
    });
  });

  bot.command('redeem', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    const [strikeStr, dirStr] = (ctx.match ?? '').trim().split(/\s+/);
    if (!strikeStr || !dirStr) {
      await ctx.reply('Usage: /redeem <strike> <up|down>  — early-exit a live position.');
      return;
    }
    const o = await activeBtcOracle(deps);
    if (!o) {
      await ctx.reply('That market may have settled — settled positions redeem automatically (keeper, ~60s).');
      return;
    }
    if (o.status === OracleStatus.SETTLED || o.status === OracleStatus.PENDING_SETTLEMENT) {
      await ctx.reply('This market is settling — it redeems automatically; no action needed.');
      return;
    }
    const strike1e9 = BigInt(Math.round(Number(strikeStr.replace(/[$,]/g, '')))) * 1_000_000_000n;
    const kb = tradeButton(deps, 'Confirm early-exit & sign', {
      action: 'redeem',
      oracleId: o.oracleId,
      expiry: String(o.expiryMs),
      strike: strike1e9.toString(),
      isUp: String(dirStr.toLowerCase() === 'up'),
    });
    await ctx.reply(`Early-exit your ${dirStr.toUpperCase()} $${strikeStr} position?`, { reply_markup: kb });
  });

  bot.callbackQuery('market:refresh', async (ctx) => {
    const o = await activeBtcOracle(deps);
    if (!o) {
      await ctx.answerCallbackQuery('No market open right now.');
      return;
    }
    const sender = (await deps.sessions.getSession(ctx.from.id))?.suiAddress ?? `0x${'0'.repeat(64)}`;
    const text = await renderMarket(deps.predict, o, sender);
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: ctx.callbackQuery.message?.reply_markup });
    } catch {
      /* message unchanged — ignore */
    }
    await ctx.answerCallbackQuery('Refreshed');
  });
}
