import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { describe, expect, it } from 'vitest';
import { buildNonce, maxEpochFromCurrent } from './nonce.js';
import { isExpired } from './session.js';

describe('nonce', () => {
  it('is deterministic for the same inputs', () => {
    const pk = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7)).getPublicKey();
    const a = buildNonce(pk, 10, '12345678901234567890');
    const b = buildNonce(pk, 10, '12345678901234567890');
    expect(a).toBe(b);
  });

  it('changes with maxEpoch', () => {
    const pk = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7)).getPublicKey();
    const a = buildNonce(pk, 10, '12345678901234567890');
    const b = buildNonce(pk, 11, '12345678901234567890');
    expect(a).not.toBe(b);
  });

  it('maxEpochFromCurrent adds the buffer', () => {
    expect(maxEpochFromCurrent(100)).toBe(102);
    expect(maxEpochFromCurrent(100, 3)).toBe(103);
  });
});

describe('session.isExpired', () => {
  it('compares against epochExpiryMs', () => {
    expect(isExpired({ epochExpiryMs: 1000 }, 999)).toBe(false);
    expect(isExpired({ epochExpiryMs: 1000 }, 1000)).toBe(true);
    expect(isExpired({ epochExpiryMs: 1000 }, 1001)).toBe(true);
  });
});
