'use client';

import { publicConfig } from './config';

/** Calls to the bot backend that owns the Enoki PRIVATE key (sponsorship). */

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${publicConfig.apiBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API ${path} failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function prepareOnboard(jwt: string) {
  return post<{ suiAddress: string }>('/api/onboard/prepare', { jwt });
}

export function sponsor(transactionKindBytes: string, sender: string) {
  return post<{ bytes: string; digest: string }>('/api/sponsor', { transactionKindBytes, sender });
}

export function executeSponsored(digest: string, signature: string) {
  return post<{ digest: string }>('/api/sponsor/execute', { digest, signature });
}

export function startOAuth(telegramId?: string) {
  return post<{ state: string }>('/api/oauth/start', { telegramId });
}

export function completeOnboard(args: { state: string; jwt: string; managerId?: string }) {
  return post<{ ok: boolean; funding?: { digest?: string; skipped?: string } }>(
    '/api/onboard/complete',
    args,
  );
}
