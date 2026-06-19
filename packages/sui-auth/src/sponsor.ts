import type { EnokiClient } from '@mysten/enoki';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import type { AuthNetwork } from './enoki.js';

/**
 * Enoki gas sponsorship (docs/02 custody model, Phase 1). Two server steps around
 * a client-side user signature:
 *   1. buildTransactionKindBytes(tx) — onlyTransactionKind, no gas
 *   2. createSponsoredTransaction(...) → { bytes, digest }   (server, private key)
 *   3. [client signs `bytes` with the ephemeral key → userSignature]
 *   4. executeSponsoredTransaction(digest, userSignature)    (server, private key)
 *
 * Always scope sponsorship with `allowedMoveCallTargets` / `allowedAddresses`
 * (per-phase allowlists, docs/06) so the sponsor can't be abused.
 */
export async function buildTransactionKindBytes(tx: Transaction, sui: SuiJsonRpcClient): Promise<string> {
  const bytes = await tx.build({ client: sui, onlyTransactionKind: true });
  return toBase64(bytes);
}

export interface SponsorParams {
  transactionKindBytes: string;
  sender: string;
  network?: AuthNetwork;
  allowedMoveCallTargets?: string[];
  allowedAddresses?: string[];
}

export interface SponsoredTransaction {
  bytes: string;
  digest: string;
}

export function createSponsoredTransaction(
  client: EnokiClient,
  p: SponsorParams,
): Promise<SponsoredTransaction> {
  return client.createSponsoredTransaction({
    network: p.network ?? 'testnet',
    transactionKindBytes: p.transactionKindBytes,
    sender: p.sender,
    allowedMoveCallTargets: p.allowedMoveCallTargets,
    allowedAddresses: p.allowedAddresses,
  });
}

export function executeSponsoredTransaction(
  client: EnokiClient,
  digest: string,
  signature: string,
): Promise<{ digest: string }> {
  return client.executeSponsoredTransaction({ digest, signature });
}
