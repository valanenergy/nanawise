/**
 * Generate a fresh Ed25519 keypair for keeper/agent/hot-wallet roles.
 * Prints the address and the bech32 `suiprivkey…` to paste into .env.
 * Run: pnpm key:new
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const kp = Ed25519Keypair.generate();
console.log('address:    ', kp.getPublicKey().toSuiAddress());
console.log('privateKey: ', kp.getSecretKey()); // suiprivkey1...
