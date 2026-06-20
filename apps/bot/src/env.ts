import { loadConfig, type PredictConfig } from '@nanawise/shared';
import { z } from 'zod';

/**
 * Bot/runtime configuration. Reuses the validated predict config (shared) and adds
 * the secrets/URLs this service needs. The Enoki PRIVATE key is server-only and is
 * never exposed to the client (docs/06).
 */
const botSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  MINI_APP_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ENOKI_PRIVATE_KEY: z.string().startsWith('enoki_private_'),
  HOT_WALLET_PRIVATE_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('suiprivkey1').optional(),
  ),
  API_PORT: z.coerce.number().default(8787),
});

export interface BotConfig {
  predict: PredictConfig;
  telegramBotToken: string;
  miniAppUrl: string;
  redisUrl: string;
  enokiPrivateKey: string;
  hotWalletPrivateKey?: string;
  apiPort: number;
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const predict = loadConfig(env);
  const parsed = botSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid bot configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  return {
    predict,
    telegramBotToken: c.TELEGRAM_BOT_TOKEN,
    miniAppUrl: c.MINI_APP_URL,
    redisUrl: c.REDIS_URL,
    enokiPrivateKey: c.ENOKI_PRIVATE_KEY,
    hotWalletPrivateKey: c.HOT_WALLET_PRIVATE_KEY,
    apiPort: c.API_PORT,
  };
}
