import { loadConfig, type PredictConfig } from '@nanawise/shared';
import { z } from 'zod';

/** Keeper configuration. The keeper owns its own gas keypair; it never uses user keys. */
const schema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  KEEPER_PRIVATE_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('suiprivkey1').optional(),
  ),
  AGENT_PRIVATE_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('suiprivkey1').optional(),
  ),
  KEEPER_POLL_MS: z.coerce.number().default(5000),
  AGENT_MANAGER_ID: z.string().optional(), // skip in settlement (Phase 4 sweeps it)
});

export interface KeeperConfig {
  predict: PredictConfig;
  redisUrl: string;
  keeperPrivateKey?: string;
  agentPrivateKey?: string;
  pollMs: number;
  agentManagerId?: string;
}

export function loadKeeperConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const predict = loadConfig(env);
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid keeper configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  return {
    predict,
    redisUrl: c.REDIS_URL,
    keeperPrivateKey: c.KEEPER_PRIVATE_KEY,
    agentPrivateKey: c.AGENT_PRIVATE_KEY,
    pollMs: c.KEEPER_POLL_MS,
    agentManagerId: c.AGENT_MANAGER_ID,
  };
}
