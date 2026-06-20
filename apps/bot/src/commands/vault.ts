import { isExpired } from '@nanawise/sui-auth';
import {
  formatUsdc,
  maxWithdrawable,
  parseUsdc,
  plpPrice,
  previewSupplyPlp,
  previewWithdrawDusdc,
} from '@nanawise/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from '../clients.js';

/**
 * PLP vault commands (Phase 6 Part A):
 *   /vault            — utilization, PLP price, withdrawal-available
 *   /supply <amount>  — Mini App signs supply (mints user-held PLP)
 *   /withdraw <amount>— Mini App signs withdraw (burns PLP for dUSDC); caps at available
 */
export function registerVaultCommands(bot: Bot, deps: Deps): void {
  async function requireSession(tgId: number) {
    const s = await deps.sessions.getSession(tgId);
    return s && !isExpired(s) ? s : null;
  }

  bot.command('vault', async (ctx) => {
    const v = await deps.predict.readVault();
    const snap = { balance: v.balance, totalMtm: v.totalMtm, totalMaxPayout: v.totalMaxPayout, plpSupply: v.plpSupply };
    const lim = { ...v.limiter, lastUpdatedMs: 0 };
    const avail = maxWithdrawable(snap, lim, Date.now());
    const util = v.balance > 0n ? Number((v.totalMaxPayout * 10000n) / v.balance) / 100 : 0;
    await ctx.reply(
      [
        '*Liquidity Vault (PLP)*',
        `Vault size: *${formatUsdc(v.balance)} dUSDC*`,
        `PLP price: *${plpPrice(snap).toFixed(4)}*`,
        `Utilization: ${util.toFixed(1)}%`,
        `Withdrawable now: ${formatUsdc(avail)} dUSDC`,
        '',
        'Provide liquidity: /supply <amount> · Pull out: /withdraw <amount>',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('supply', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    let amount: bigint;
    try {
      amount = parseUsdc((ctx.match ?? '').trim());
    } catch {
      await ctx.reply('Usage: /supply <amount>\nExample: /supply 100');
      return;
    }
    const v = await deps.predict.readVault();
    const snap = { balance: v.balance, totalMtm: v.totalMtm, totalMaxPayout: v.totalMaxPayout, plpSupply: v.plpSupply };
    const expectedPlp = previewSupplyPlp(snap, amount);
    const kb = new InlineKeyboard().webApp(
      `Supply ${formatUsdc(amount)} dUSDC →`,
      `${deps.cfg.miniAppUrl}/miniapp/vault?action=supply&amount=${amount}`,
    );
    await ctx.reply(
      `Supply *${formatUsdc(amount)} dUSDC* → receive ≈ *${formatUsdc(expectedPlp)} PLP*. You earn the vault's trading spread.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  bot.command('withdraw', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    let plpAmount: bigint;
    try {
      plpAmount = parseUsdc((ctx.match ?? '').trim());
    } catch {
      await ctx.reply('Usage: /withdraw <PLP amount>\nExample: /withdraw 50');
      return;
    }
    const v = await deps.predict.readVault();
    const snap = { balance: v.balance, totalMtm: v.totalMtm, totalMaxPayout: v.totalMaxPayout, plpSupply: v.plpSupply };
    const lim = { ...v.limiter, lastUpdatedMs: 0 };
    const expectedDusdc = previewWithdrawDusdc(snap, plpAmount);
    const avail = maxWithdrawable(snap, lim, Date.now());
    if (expectedDusdc > avail) {
      await ctx.reply(
        `That would return ${formatUsdc(expectedDusdc)} dUSDC but only *${formatUsdc(avail)}* is withdrawable right now (vault coverage/limiter). Try a smaller amount.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    const kb = new InlineKeyboard().webApp(
      `Withdraw ${formatUsdc(plpAmount)} PLP →`,
      `${deps.cfg.miniAppUrl}/miniapp/vault?action=withdraw&amount=${plpAmount}`,
    );
    await ctx.reply(`Burn *${formatUsdc(plpAmount)} PLP* → receive ≈ *${formatUsdc(expectedDusdc)} dUSDC*.`, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  });
}
