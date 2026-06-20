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
  const deps = buildDeps(cfg);
  const bot = buildBot(deps);
  startApiServer(deps, bot);
  startSettlementWorker(deps, bot);
  startCopyWorker(deps, bot);
  console.log('[bot] starting (long polling)…');
  await bot.start();
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
