import { createEnokiClient, SessionStore, type EnokiClient } from '@nanawise/sui-auth';
import { PredictClient, type PredictSdkConfig } from '@nanawise/predict-sdk';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Redis } from 'ioredis';
import type { BotConfig } from './env.js';

/** Wired runtime dependencies shared by the bot and the HTTP API. */
export interface Deps {
  cfg: BotConfig;
  sui: SuiJsonRpcClient;
  predict: PredictClient;
  enoki: EnokiClient; // private-key client (server-side sponsorship)
  redis: Redis;
  sessions: SessionStore;
  hotWallet?: Ed25519Keypair;
  faucetWallet?: Ed25519Keypair; // dev faucet funder (SUI + dUSDC), testnet-only
}

export function buildDeps(cfg: BotConfig): Deps {
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
  };
  const predict = new PredictClient(sui, sdkCfg);
  const enoki = createEnokiClient(cfg.enokiPrivateKey);
  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  const sessions = new SessionStore(redis);
  const hotWallet = cfg.hotWalletPrivateKey
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.hotWalletPrivateKey).secretKey)
    : undefined;
  const faucetWallet = cfg.faucetPrivateKey
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.faucetPrivateKey).secretKey)
    : undefined;
  return { cfg, sui, predict, enoki, redis, sessions, hotWallet, faucetWallet };
}
