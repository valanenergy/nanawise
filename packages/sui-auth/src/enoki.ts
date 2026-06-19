import { EnokiClient } from '@mysten/enoki';
import type { EnokiNetwork } from '@mysten/enoki';

export type { EnokiClient } from '@mysten/enoki';
import type { PublicKey } from '@mysten/sui/cryptography';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';

/**
 * Thin, injectable wrappers over the Enoki low-level client (docs/03/06, Phase 1).
 *
 * - zkLogin user flows (nonce / identity / ZKP) can run with the PUBLIC key.
 * - Sponsorship (sponsor.ts) MUST use the PRIVATE key, server-side only.
 * - `network` defaults to testnet everywhere (Enoki defaults to mainnet — CC-5).
 */
export type AuthNetwork = EnokiNetwork; // 'mainnet' | 'testnet' | 'devnet'

export function createEnokiClient(apiKey: string): EnokiClient {
  return new EnokiClient({ apiKey });
}

export interface ZkLoginIdentity {
  address: string;
  publicKey: string;
  salt: string;
}

/** Resolve the stable zkLogin address for a Google id_token (Enoki owns the salt). */
export function getZkLoginIdentity(client: EnokiClient, jwt: string): Promise<ZkLoginIdentity> {
  return client.getZkLogin({ jwt });
}

export interface NonceResult {
  nonce: string;
  randomness: string;
  epoch: number;
  maxEpoch: number;
  estimatedExpiration: number;
}

/** Create an Enoki-managed nonce for an ephemeral public key (maxEpoch = current + additionalEpochs). */
export function createNonce(
  client: EnokiClient,
  ephemeralPublicKey: PublicKey,
  network: AuthNetwork = 'testnet',
  additionalEpochs = 2,
): Promise<NonceResult> {
  return client.createZkLoginNonce({ ephemeralPublicKey, network, additionalEpochs });
}

export interface ZkpParams {
  jwt: string;
  ephemeralPublicKey: PublicKey;
  randomness: string;
  maxEpoch: number;
  network?: AuthNetwork;
}

/** Produce the zkLogin proof inputs used to assemble the user's signature. */
export function createZkp(client: EnokiClient, p: ZkpParams): Promise<ZkLoginSignatureInputs> {
  return client.createZkLoginZkp({
    jwt: p.jwt,
    ephemeralPublicKey: p.ephemeralPublicKey,
    randomness: p.randomness,
    maxEpoch: p.maxEpoch,
    network: p.network ?? 'testnet',
  });
}
