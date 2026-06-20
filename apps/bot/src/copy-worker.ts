import { formatStrike } from '@nanawise/shared';
import { Worker } from 'bullmq';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from './clients.js';

const COPY_TRADE_QUEUE = 'copy-trade';

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
 * Copy-trade worker (Phase 7, confirm mode). A consenting target minted a position →
 * the follower gets a one-tap Mini App prompt to sign the mirrored trade. No custody
 * is given up (the follower signs with their own client-held key). Agent-copy mode is
 * handled in the keeper's agent path, not here.
 */
export function startCopyWorker(deps: Deps, bot: Bot): Worker {
  const worker = new Worker(
    COPY_TRADE_QUEUE,
    async (job) => {
      const d = job.data as {
        followerTelegramId: string;
        oracle: string;
        expiry: string;
        strike: string;
        isUp: boolean;
        sizing: { fraction?: number; fixedAmount?: string };
        mode: string;
      };
      const tgId = Number(d.followerTelegramId);
      if (!tgId || d.mode !== 'confirm') return;

      // sizing: fixed amount, else default 1 contract (fraction sizing resolved client-side)
      const qty = d.sizing.fixedAmount ?? '1000000';
      const kb = new InlineKeyboard().webApp(
        'Copy this trade →',
        `${deps.cfg.miniAppUrl}/miniapp/trade?action=mint&oracleId=${d.oracle}&expiry=${d.expiry}&strike=${d.strike}&isUp=${d.isUp}&quantity=${qty}`,
      );
      await bot.api.sendMessage(
        tgId,
        `👯 A trader you follow just went *${d.isUp ? 'UP' : 'DOWN'} $${formatStrike(BigInt(d.strike))}*. Copy it?`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );
    },
    { connection: bullConnection(deps.cfg.redisUrl), concurrency: 5 },
  );
  worker.on('failed', (job, err) => console.error(`[copy-worker] ${job?.id} failed:`, err.message));
  return worker;
}
