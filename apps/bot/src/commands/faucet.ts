import { coinWithBalance, Transaction } from '@mysten/sui/transactions';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { formatUsdc, parseUsdc } from '@nanawise/shared';
import type { Bot } from 'grammy';
import type { Deps } from '../clients.js';

/**
 * Dev faucet (testnet-only). Sends SUI + dUSDC from the faucet funder wallet
 * (FAUCET_PRIVATE_KEY, falling back to DEV_PRIVATE_KEY) to whatever address needs
 * it — the caller's onboarded wallet by default, or an explicit address.
 *
 * Usage:
 *   /faucet                      → 10 dUSDC + 1 SUI to your onboarded wallet
 *   /faucet <usdc> <sui>         → custom amounts to your onboarded wallet
 *   /faucet 0x<addr> [usdc] [sui]→ custom amounts to a specific address
 *
 * Both transfers ride in one PTB signed by the funder, so a single digest covers
 * both. SUI is split off the gas coin; dUSDC is assembled via coinWithBalance.
 */
const DEFAULT_USDC = '10'; // human dUSDC
const DEFAULT_SUI = 1; // SUI

const trunc = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function registerFaucetCommand(bot: Bot, deps: Deps): void {
  bot.command('faucet', async (ctx) => {
    if (!deps.faucetWallet) {
      await ctx.reply('Faucet is not configured (set FAUCET_PRIVATE_KEY or DEV_PRIVATE_KEY).');
      return;
    }

    const args = (ctx.match ?? '').trim().split(/\s+/).filter(Boolean);

    // First arg may be a target address; otherwise default to the caller's wallet.
    let target: string | undefined;
    let amounts = args;
    if (args[0] && isValidSuiAddress(args[0])) {
      target = args[0];
      amounts = args.slice(1);
    } else {
      const sess = await deps.sessions.getSession(ctx.from?.id ?? 0);
      target = sess?.suiAddress;
    }
    if (!target) {
      await ctx.reply('No wallet found. Tap /start to set one up, or pass an address: /faucet 0x… 10 1');
      return;
    }

    let usdcBase: bigint;
    let suiMist: bigint;
    try {
      usdcBase = parseUsdc(amounts[0] ?? DEFAULT_USDC); // 1e6
      suiMist = BigInt(Math.round(Number(amounts[1] ?? DEFAULT_SUI) * 1e9)); // 1e9
    } catch {
      await ctx.reply('Could not read amounts. Example: /faucet 10 1  (10 dUSDC + 1 SUI)');
      return;
    }
    if (usdcBase <= 0n && suiMist <= 0n) {
      await ctx.reply('Nothing to send — amounts are zero.');
      return;
    }

    await ctx.reply(`Sending ${formatUsdc(usdcBase)} dUSDC + ${Number(suiMist) / 1e9} SUI to ${trunc(target)}…`);

    try {
      const tx = new Transaction();
      if (suiMist > 0n) {
        const [sui] = tx.splitCoins(tx.gas, [suiMist]);
        tx.transferObjects([sui], target);
      }
      if (usdcBase > 0n) {
        const usdc = coinWithBalance({ type: deps.cfg.predict.dusdcType, balance: usdcBase });
        tx.transferObjects([usdc], target);
      }
      const res = await deps.sui.signAndExecuteTransaction({
        signer: deps.faucetWallet,
        transaction: tx,
        options: { showEffects: true },
      });
      await deps.sui.waitForTransaction({ digest: res.digest });
      if (res.effects?.status?.status !== 'success') {
        await ctx.reply(`Faucet tx did not succeed: ${res.effects?.status?.error ?? 'unknown'}`);
        return;
      }
      await ctx.reply(
        [
          `✅ Sent ${formatUsdc(usdcBase)} dUSDC + ${Number(suiMist) / 1e9} SUI`,
          `to ${trunc(target)}`,
          `tx: ${res.digest}`,
        ].join('\n'),
      );
    } catch (e) {
      const msg = (e as Error).message;
      // Most common dev cause: funder ran dry.
      const hint = /insufficient|balance|gas/i.test(msg) ? ' (funder wallet may be out of SUI/dUSDC)' : '';
      await ctx.reply(`Faucet failed: ${msg.slice(0, 200)}${hint}`);
    }
  });
}
