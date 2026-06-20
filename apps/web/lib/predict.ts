'use client';

import { PredictClient } from '@nanawise/predict-sdk';
import { sdkConfig } from './config';
import { newSdkClient } from './execute';

/** Singleton PredictClient for dashboard reads (browser). */
let _client: PredictClient | null = null;
export function predictClient(): PredictClient {
  if (!_client) _client = new PredictClient(newSdkClient(), sdkConfig());
  return _client;
}

/** The connected account: zkLogin session address + cached managerId (Phase 5 connection layer). */
export function useAccount(): { suiAddress?: string; managerId?: string } {
  if (typeof window === 'undefined') return {};
  let suiAddress: string | undefined;
  try {
    const zk = sessionStorage.getItem('nanawise.zksession');
    if (zk) suiAddress = (JSON.parse(zk) as { address?: string }).address;
  } catch {
    /* ignore */
  }
  const managerId = sessionStorage.getItem('nanawise.managerId') ?? undefined;
  return { suiAddress, managerId };
}

/** Pick the nearest ACTIVE BTC oracle (used by Market/Surface). */
export async function activeBtcOracle() {
  const p = predictClient();
  const now = Date.now();
  const oracles = await p.getOracles();
  const btc = oracles
    .filter((o) => /btc/i.test(o.underlyingAsset ?? '') && (o.expiryMs ?? 0) > now)
    .sort((a, b) => (a.expiryMs ?? 0) - (b.expiryMs ?? 0));
  for (const o of btc.slice(0, 8)) {
    const st = await p.getOracleState(o.oracleId);
    if (st.active) return st;
  }
  return undefined;
}
