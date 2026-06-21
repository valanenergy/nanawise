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
  console.log('[zklogin] enoki() - apiKey:', publicConfig.enokiPublicKey?.slice(0, 15) + '...');
  if (!publicConfig.enokiPublicKey) {
    console.error('[zklogin] ERROR: enokiPublicKey is empty!');
  }
  return new EnokiClient({ apiKey: publicConfig.enokiPublicKey });
}

/**
 * zkLogin state is kept in localStorage (shared across tabs / Telegram webviews of
 * the same origin), NOT sessionStorage (per-tab) — otherwise the trade/pay screen
 * opened in a fresh webview can't see the session and demands a re-sign-in.
 */
const store = (): Storage => window.localStorage;

/**
 * One-time migration: earlier builds stored the session in sessionStorage. Copy any
 * value from there into localStorage so an already-signed-in user isn't forced to
 * re-authenticate after this change.
 */
function migrated(key: string): string | null {
  const cur = store().getItem(key);
  if (cur) return cur;
  try {
    const old = window.sessionStorage.getItem(key);
    if (old) {
      store().setItem(key, old);
      return old;
    }
  } catch {
    /* sessionStorage may be unavailable; ignore */
  }
  return null;
}

/** Persist/restore the ephemeral keypair across the OAuth redirect. */
function saveEphemeral(kp: Ed25519Keypair): void {
  store().setItem(EPHEMERAL_KEY, kp.getSecretKey());
}
export function loadEphemeral(): Ed25519Keypair | null {
  const sk = migrated(EPHEMERAL_KEY);
  return sk ? Ed25519Keypair.fromSecretKey(sk) : null;
}

export function getZkSession(): ZkSession | null {
  const v = migrated(ZK_SESSION);
  return v ? (JSON.parse(v) as ZkSession) : null;
}
function saveZkSession(s: ZkSession): void {
  store().setItem(ZK_SESSION, JSON.stringify(s));
}
/** Full client-side sign-out: wipe every auth artifact from BOTH storages. */
export function clearZk(): void {
  const keys = [EPHEMERAL_KEY, ZK_SESSION, 'nanawise.nonce', 'nanawise.managerId', 'oauth-state'];
  for (const k of keys) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    try {
      window.sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Step 1: generate the ephemeral key, get an Enoki nonce, and return the Google
 * OAuth URL (implicit id_token flow with the nonce embedded). `state` round-trips
 * the bot's deep-link state back to us.
 */
export async function beginLogin(state: string): Promise<string> {
  const kp = new Ed25519Keypair();
  saveEphemeral(kp);
  const pubKey = kp.getPublicKey();
  console.log('[zklogin] beginLogin - network:', publicConfig.network);
  const { nonce, randomness, maxEpoch } = await enoki().createZkLoginNonce({
    network: publicConfig.network,
    ephemeralPublicKey: pubKey,
  });
  store().setItem('nanawise.nonce', JSON.stringify({ randomness, maxEpoch, state }));

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
  const meta = JSON.parse(store().getItem('nanawise.nonce') ?? '{}') as {
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
