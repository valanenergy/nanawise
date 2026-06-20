import { formatStrike, formatUsdc } from '@nanawise/shared';
import { Worker } from 'bullmq';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from './clients.js';

const SETTLEMENT_QUEUE = 'settlement-notifications';

/** BullMQ connection options from a redis:// URL (own dedicated connection). */
function bullConnection(redisUrl: string) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    password: u.password || undefined,
    username: u.username || undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Consumes settlement DM jobs from the keeper (Phase 3) and sends the human
 * settlement message. Job shapes:
 *   settlement   { telegramId, result:'won'|'lost', payout, strike, direction, oracleId }
 *   range-claim  { telegramId, oracleId, lowerStrike, higherStrike }
 */
export function startSettlementWorker(deps: Deps, bot: Bot): Worker {
  const worker = new Worker(
    SETTLEMENT_QUEUE,
    async (job) => {
      const d = job.data as Record<string, string>;
      const tgId = Number(d.telegramId);
      if (!tgId) return;

      if (job.name === 'range-claim') {
        const kb = new InlineKeyboard().webApp(
          'Claim payout →',
          `${deps.cfg.miniAppUrl}/miniapp/trade?action=redeemRange&oracleId=${d.oracleId}&lowerStrike=${d.lowerStrike}&higherStrike=${d.higherStrike}`,
        );
        await bot.api.sendMessage(
          tgId,
          `📐 Your range $${formatStrike(BigInt(d.lowerStrike ?? '0'))}–$${formatStrike(BigInt(d.higherStrike ?? '0'))} settled. Tap to claim your payout.`,
          { reply_markup: kb },
        );
        return;
      }

      const won = d.result === 'won';
      const payout = formatUsdc(BigInt(d.payout ?? '0'));
      const dir = (d.direction ?? '').toUpperCase();
      const strike = formatStrike(BigInt(d.strike ?? '0'));
      const kb = new InlineKeyboard()
        .text('Trade again', 'trade:again')
        .text('Share result', 'share:result');
      const text = won
        ? [`✅ Settled — *WON* 🎉`, `Your ${dir} $${strike} position paid *${payout} dUSDC*`, `Added to your balance.`].join('\n')
        : [`Settled — no payout this time.`, `Your ${dir} $${strike} position closed out of the money.`].join('\n');
      await bot.api.sendMessage(tgId, text, { parse_mode: 'Markdown', reply_markup: kb });
    },
    { connection: bullConnection(deps.cfg.redisUrl), concurrency: 5 },
  );

  worker.on('failed', (job, err) => console.error(`[settlement-worker] job ${job?.id} failed:`, err.message));
  return worker;
}
