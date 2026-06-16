import { z } from 'zod';

/**
 * Typed, validated runtime configuration. Every on-chain ID, URL, and key comes
 * from env (docs/02 cross-cutting). loadConfig() fails fast with a readable list
 * of missing/invalid keys.
 *
 * Phases add their own keys; the base schema below covers Phase 0 (spike) needs.
 * Optional groups (Enoki, Telegram, infra) are validated lazily by their owners.
 */

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/, 'must be a 0x-prefixed hex object/package id');

const baseSchema = z.object({
  SUI_NETWORK: z.enum(['testnet', 'mainnet', 'devnet', 'localnet']).default('testnet'),
  SUI_RPC_URL: z.string().url(),

  PREDICT_SERVER_URL: z.string().url(),
  PREDICT_PACKAGE_ID: hex,
  PREDICT_REGISTRY_ID: hex,
  PREDICT_OBJECT_ID: hex,
  DUSDC_TYPE: z.string().min(3),
  DUSDC_CURRENCY_ID: hex,
  PLP_TYPE: z.string().min(3),
  CLOCK_ID: hex.default('0x6'),

  AGENT_POLICY_PACKAGE_ID: z.preprocess((v) => (v === '' ? undefined : v), hex.optional()),
  ACTIVITY_LOG_PACKAGE_ID: z.preprocess((v) => (v === '' ? undefined : v), hex.optional()),
  TOURNAMENT_PACKAGE_ID: z.preprocess((v) => (v === '' ? undefined : v), hex.optional()),

  DEV_PRIVATE_KEY: z.string().startsWith('suiprivkey1').optional(),
});

export type BaseConfig = z.infer<typeof baseSchema>;

export interface PredictConfig {
  network: BaseConfig['SUI_NETWORK'];
  rpcUrl: string;
  serverUrl: string;
  predictPackageId: string;
  predictRegistryId: string;
  predictObjectId: string;
  dusdcType: string;
  dusdcCurrencyId: string;
  plpType: string;
  clockId: string;
  agentPolicyPackageId?: string;
  activityLogPackageId?: string;
  tournamentPackageId?: string;
  devPrivateKey?: string;
}

/**
 * Validate `env` (defaults to process.env) and return a typed config.
 * Throws an Error listing every offending key if validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): PredictConfig {
  const parsed = baseSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  return {
    network: c.SUI_NETWORK,
    rpcUrl: c.SUI_RPC_URL,
    serverUrl: c.PREDICT_SERVER_URL,
    predictPackageId: c.PREDICT_PACKAGE_ID,
    predictRegistryId: c.PREDICT_REGISTRY_ID,
    predictObjectId: c.PREDICT_OBJECT_ID,
    dusdcType: c.DUSDC_TYPE,
    dusdcCurrencyId: c.DUSDC_CURRENCY_ID,
    plpType: c.PLP_TYPE,
    clockId: c.CLOCK_ID,
    agentPolicyPackageId: c.AGENT_POLICY_PACKAGE_ID,
    activityLogPackageId: c.ACTIVITY_LOG_PACKAGE_ID,
    tournamentPackageId: c.TOURNAMENT_PACKAGE_ID,
    devPrivateKey: c.DEV_PRIVATE_KEY,
  };
}
