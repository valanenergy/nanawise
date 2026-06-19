import type { PublicKey } from '@mysten/sui/cryptography';
import { generateNonce, generateRandomness } from '@mysten/sui/zklogin';

/**
 * Client-side nonce helpers for the Mini App (where the ephemeral key is held).
 * Ordering (validated, CC-4): ephemeral key → maxEpoch = current + 2 → randomness
 * → nonce → embed in the Google OAuth request BEFORE sign-in.
 *
 * The server can alternatively use Enoki's createZkLoginNonce (enoki.ts); both
 * produce a compatible nonce.
 */
export function newRandomness(): string {
  return generateRandomness();
}

export function buildNonce(ephemeralPublicKey: PublicKey, maxEpoch: number, randomness: string): string {
  return generateNonce(ephemeralPublicKey, maxEpoch, randomness);
}

/** maxEpoch = currentEpoch + additional (default 2 ≈ 48h). */
export function maxEpochFromCurrent(currentEpoch: number, additional = 2): number {
  return currentEpoch + additional;
}
