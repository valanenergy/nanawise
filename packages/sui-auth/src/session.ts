import type { Redis } from 'ioredis';

/**
 * Redis session/OAuth store (docs/05). With client-held keys, Redis stores ONLY
 * public metadata — never the ephemeral private key.
 */

/** Session pointer kept until maxEpoch (no private key). */
export interface SessionPointer {
  suiAddress: string;
  managerId?: string;
  maxEpoch: number;
  epochExpiryMs: number;
}

/**
 * Pre-login OAuth state (5-min TTL; public key only). At `/start` only `telegramId`
 * is known; the Mini App fills the ephemeral-key fields client-side before sign-in.
 */
export interface OAuthState {
  telegramId: string;
  ephemeralPublicKey?: string;
  nonce?: string;
  maxEpoch?: number;
  randomness?: string;
}

export const sessionKey = (telegramId: string | number): string => `sess:${telegramId}`;
export const oauthKey = (state: string): string => `oauth:${state}`;

/** Pure expiry check (unit-testable, no Redis). */
export function isExpired(s: Pick<SessionPointer, 'epochExpiryMs'>, nowMs: number = Date.now()): boolean {
  return nowMs >= s.epochExpiryMs;
}

const OAUTH_TTL_SEC = 300; // 5 min

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async getSession(telegramId: string | number): Promise<SessionPointer | null> {
    const v = await this.redis.get(sessionKey(telegramId));
    return v ? (JSON.parse(v) as SessionPointer) : null;
  }

  async setSession(telegramId: string | number, s: SessionPointer, ttlSec: number): Promise<void> {
    await this.redis.set(sessionKey(telegramId), JSON.stringify(s), 'EX', ttlSec);
  }

  /** Create only if absent — prevents double-onboarding races (docs/05 SET NX). */
  async createSessionNX(telegramId: string | number, s: SessionPointer, ttlSec: number): Promise<boolean> {
    const res = await this.redis.set(sessionKey(telegramId), JSON.stringify(s), 'EX', ttlSec, 'NX');
    return res === 'OK';
  }

  async putOAuthState(state: string, data: OAuthState, ttlSec: number = OAUTH_TTL_SEC): Promise<void> {
    await this.redis.set(oauthKey(state), JSON.stringify(data), 'EX', ttlSec);
  }

  /** Single-use: atomic read+delete (GETDEL) so a state can't be replayed. */
  async takeOAuthState(state: string): Promise<OAuthState | null> {
    const v = await this.redis.getdel(oauthKey(state));
    return v ? (JSON.parse(v) as OAuthState) : null;
  }
}
