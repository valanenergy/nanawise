import { PredictClient, type PredictSdkConfig } from '@nanawise/predict-sdk';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { KeeperConfig } from './env.js';

export const SETTLEMENT_QUEUE = 'settlement-notifications';
export const COPY_TRADE_QUEUE = 'copy-trade';

/**
 * BullMQ connection options from a redis:// URL. We pass OPTIONS (not a shared
 * ioredis instance) so bullmq builds its own dedicated connection — required for
 * blocking Worker commands and avoids cross-version ioredis type skew.
 */
export function bullConnection(redisUrl: string) {
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

export interface KeeperDeps {
  cfg: KeeperConfig;
  sui: SuiJsonRpcClient;
  predict: PredictClient;
  redis: Redis;
  queue: Queue;
  copyQueue: Queue;
  keeper?: Ed25519Keypair;
  agent?: Ed25519Keypair;
}

export function buildKeeperDeps(cfg: KeeperConfig): KeeperDeps {
  const sui = new SuiJsonRpcClient({ url: cfg.predict.rpcUrl, network: cfg.predict.network });
  const sdkCfg: PredictSdkConfig = {
    rpcUrl: cfg.predict.rpcUrl,
    serverUrl: cfg.predict.serverUrl,
    predictPackageId: cfg.predict.predictPackageId,
    predictObjectId: cfg.predict.predictObjectId,
    predictRegistryId: cfg.predict.predictRegistryId,
    dusdcType: cfg.predict.dusdcType,
    plpType: cfg.predict.plpType,
    clockId: cfg.predict.clockId,
    agentPolicyPackageId: cfg.predict.agentPolicyPackageId,
    activityLogPackageId: cfg.predict.activityLogPackageId,
  };
  const predict = new PredictClient(sui, sdkCfg);
  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(SETTLEMENT_QUEUE, { connection: bullConnection(cfg.redisUrl) });
  const copyQueue = new Queue(COPY_TRADE_QUEUE, { connection: bullConnection(cfg.redisUrl) });
  const keeper = cfg.keeperPrivateKey
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.keeperPrivateKey).secretKey)
    : undefined;
  const agent = cfg.agentPrivateKey
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.agentPrivateKey).secretKey)
    : undefined;
  return { cfg, sui, predict, redis, queue, copyQueue, keeper, agent };
}
