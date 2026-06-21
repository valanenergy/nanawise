import 'dotenv/config';
import { startApiServer } from './api.js';
import { buildBot } from './bot.js';
import { buildDeps } from './clients.js';
import { loadBotConfig } from './env.js';
import { startCopyWorker } from './copy-worker.js';
import { startSettlementWorker } from './settlement-worker.js';

/**
 * Bot entrypoint. Run from the repo root so dotenv picks up the root .env:
 *   pnpm --filter @nanawise/bot start   (cwd = apps/bot) → set env first, or
 *   tsx apps/bot/src/index.ts           (cwd = repo root)
 */
async function main() {
  const cfg = loadBotConfig();
  console.log('[bot] loaded config, telegram token:', cfg.telegramBotToken.slice(0, 10) + '...');

  const deps = buildDeps(cfg);
  console.log('[bot] built dependencies');

  const bot = buildBot(deps);
  console.log('[bot] built bot');

  startApiServer(deps, bot);
  console.log('[bot] started API server');

  startSettlementWorker(deps, bot);
  startCopyWorker(deps, bot);

  console.log('[bot] starting (long polling)…');
  try {
    await bot.start();
    console.log('[bot] bot.start() completed - this should not log if polling continues');
  } catch (err) {
    console.error('[bot] bot.start() threw error:', err);
    throw err;
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
