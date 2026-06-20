'use client';

import { EnokiClient } from '@mysten/enoki';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';
import { publicConfig } from './config';

/**
 * Client-side zkLogin (docs/01 §2.2, Phase 1). The ephemeral key is generated and
 * held IN THE BROWSER (sessionStorage) — the backend never sees the private key.
 * Trades are therefore genuinely self-custodial; the backend only sponsors gas.
 *
 * Flow:
 *   beginLogin()  → ephemeral key + Enoki nonce → redirect to Google (nonce embedded)
 *   completeLogin(jwt) → Enoki address + ZKP → store proof
 *   assembleSignature(ephSig, bytesSig) → zkLogin signature for an executed tx
 */

const EPHEMERAL_KEY = 'nanawise.ephemeral';
const ZK_SESSION = 'nanawise.zksession';

export interface ZkSession {
  jwt: string;
  address: string;
  maxEpoch: number;
  randomness: string;
  proof: ZkLoginSignatureInputs;
}

function enoki(): EnokiClient {
  return new EnokiClient({ apiKey: publicConfig.enokiPublicKey });
}

/** Persist/restore the ephemeral keypair across the OAuth redirect. */
function saveEphemeral(kp: Ed25519Keypair): void {
  sessionStorage.setItem(EPHEMERAL_KEY, kp.getSecretKey());
}
export function loadEphemeral(): Ed25519Keypair | null {
  const sk = sessionStorage.getItem(EPHEMERAL_KEY);
  return sk ? Ed25519Keypair.fromSecretKey(sk) : null;
}

export function getZkSession(): ZkSession | null {
  const v = sessionStorage.getItem(ZK_SESSION);
  return v ? (JSON.parse(v) as ZkSession) : null;
}
function saveZkSession(s: ZkSession): void {
  sessionStorage.setItem(ZK_SESSION, JSON.stringify(s));
}
export function clearZk(): void {
  sessionStorage.removeItem(EPHEMERAL_KEY);
  sessionStorage.removeItem(ZK_SESSION);
}

/**
 * Step 1: generate the ephemeral key, get an Enoki nonce, and return the Google
 * OAuth URL (implicit id_token flow with the nonce embedded). `state` round-trips
 * the bot's deep-link state back to us.
 */
export async function beginLogin(state: string): Promise<string> {
  const kp = new Ed25519Keypair();
  saveEphemeral(kp);
  const { nonce, randomness, maxEpoch } = await enoki().createZkLoginNonce({
    network: publicConfig.network,
    ephemeralPublicKey: kp.getPublicKey(),
  });
  sessionStorage.setItem('nanawise.nonce', JSON.stringify({ randomness, maxEpoch, state }));

  const params = new URLSearchParams({
    client_id: publicConfig.googleClientId,
    redirect_uri: publicConfig.redirectUri,
    response_type: 'id_token',
    scope: 'openid email',
    nonce,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Step 2: exchange the Google id_token for the zkLogin address + proof, persist it. */
export async function completeLogin(jwt: string): Promise<ZkSession> {
  const kp = loadEphemeral();
  if (!kp) throw new Error('ephemeral key missing — restart sign-in');
  const meta = JSON.parse(sessionStorage.getItem('nanawise.nonce') ?? '{}') as {
    randomness?: string;
    maxEpoch?: number;
  };
  if (!meta.randomness || !meta.maxEpoch) throw new Error('nonce metadata missing — restart sign-in');

  const client = enoki();
  const identity = await client.getZkLogin({ jwt });
  const proof = await client.createZkLoginZkp({
    network: publicConfig.network,
    jwt,
    ephemeralPublicKey: kp.getPublicKey(),
    randomness: meta.randomness,
    maxEpoch: meta.maxEpoch,
  });
  const session: ZkSession = {
    jwt,
    address: identity.address,
    maxEpoch: meta.maxEpoch,
    randomness: meta.randomness,
    proof,
  };
  saveZkSession(session);
  return session;
}

/**
 * Assemble a full zkLogin signature from the ephemeral signature over the sponsored
 * tx bytes. `userSignatureBytes` is the ephemeral Ed25519 signature (base64) over the
 * transaction the backend sponsored.
 */
export function assembleZkLoginSignature(
  session: ZkSession,
  ephemeralSignature: string,
): string {
  return getZkLoginSignature({
    inputs: { ...session.proof, addressSeed: session.proof.addressSeed },
    maxEpoch: session.maxEpoch,
    userSignature: ephemeralSignature,
  });
}
