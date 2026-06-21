'use client';

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { executeSponsored, sponsor } from './api';
import { publicConfig } from './config';
import { assembleZkLoginSignature, getZkSession, loadEphemeral } from './zklogin';

/**
 * Execute a state-changing transaction the self-custodial way (docs/02):
 *   1. build onlyTransactionKind bytes (client)
 *   2. backend sponsors gas → { bytes, digest }  (Enoki private key, server-side)
 *   3. sign the sponsored bytes with the CLIENT-HELD ephemeral key
 *   4. wrap in a zkLogin signature and execute via the backend
 *
 * The backend never sees the ephemeral private key.
 */
export async function signAndExecuteSponsored(tx: Transaction): Promise<string> {
  const session = getZkSession();
  const kp = loadEphemeral();
  if (!session) throw new Error('Not signed in. Please sign in with Google again.');
  if (!kp) throw new Error('Session key missing. Please sign in again.');

  // Sender must be set BEFORE build: coinWithBalance (used by deposit) resolves the
  // user's coins by querying the sender's owned objects during build. Without it the
  // build throws "Sender must be set to resolve CoinWithBalance". The sender isn't
  // serialized into the onlyTransactionKind bytes — the sponsor sets gas separately.
  tx.setSender(session.address);
  const sui = new SuiJsonRpcClient({ url: publicConfig.rpcUrl, network: publicConfig.network });
  const kindBytes = toBase64(await tx.build({ client: sui, onlyTransactionKind: true }));

  // 2. sponsor (server)
  const sponsored = await sponsor(kindBytes, session.address);

  // 3. sign the sponsored full-tx bytes with the ephemeral key
  const bytes = Uint8Array.from(atob(sponsored.bytes), (c) => c.charCodeAt(0));
  const { signature: ephemeralSig } = await kp.signTransaction(bytes);

  // 4. wrap as a zkLogin signature and execute (server)
  const zkSignature = assembleZkLoginSignature(session, ephemeralSig);
  const { digest } = await executeSponsored(sponsored.digest, zkSignature);
  return digest;
}

export function newSdkClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: publicConfig.rpcUrl, network: publicConfig.network });
}
