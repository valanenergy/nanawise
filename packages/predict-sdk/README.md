# @nanawise/predict-sdk

TypeScript SDK for **DeepBook Predict** on Sui — binary & range options, the PLP liquidity vault, and on-chain agent wallets. Typed predict-server reads, on-chain `devInspect` reads, and unsigned PTB builders you sign/sponsor however you like.

> Validated against `MystenLabs/deepbookv3 @ predict-testnet-4-16`. The SDK never signs or sponsors — builders return an unsigned `Transaction`.

## Install

```bash
npm install @nanawise/predict-sdk @mysten/sui
```

## Quick start — mint a BTC-UP position

```ts
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { PredictClient } from '@nanawise/predict-sdk';

const sui = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });
const predict = new PredictClient(sui, {
  rpcUrl: 'https://fullnode.testnet.sui.io:443',
  serverUrl: 'https://predict-server.testnet.mystenlabs.com',
  predictPackageId: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  predictObjectId: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  predictRegistryId: '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64',
  dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  plpType: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP',
  clockId: '0x6',
});

const kp = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const me = kp.getPublicKey().toSuiAddress();

// 1. find an active BTC oracle + a grid-aligned strike
const [oracle] = (await predict.getOracles()).filter((o) => /btc/i.test(o.underlyingAsset ?? ''));
const state = await predict.getOracleState(oracle.oracleId);
predict.assertTradable(state); // throws a human error if stale/settled/paused
const strike = (state.forward1e9 / 1_000_000_000n) * 1_000_000_000n; // round to the $1 tick

// 2. preview, then build deposit + mint (mint spends the manager's INTERNAL balance)
const { cost } = await predict.previewMint({ oracleId: oracle.oracleId, expiry: BigInt(state.expiryMs), strike, isUp: true, quantity: 1_000_000n }, me);
const managerId = '0x...'; // from buildCreateManager()
const tx = predict.buildDeposit({ managerId, coinType: predict.cfg.dusdcType, amount: cost + cost / 50n });
predict.buildMint({ managerId, oracleId: oracle.oracleId, expiry: BigInt(state.expiryMs), strike, isUp: true, quantity: 1_000_000n }, tx);
const res = await sui.signAndExecuteTransaction({ signer: kp, transaction: tx });
console.log('minted:', res.digest);
```

## What's inside

- **Reads** — `getOracles`, `getOracleState` (normalizes the real server shape incl. signed SVI), `getManagerPnl`, `getPositionsMinted/Redeemed`, `getRangesMinted`, `readVault`, `readAgentPolicy`, `getStatus`.
- **On-chain** — `previewMint/Redeem`, `previewMintRange/RedeemRange`, `getManagerBalance`, `getManagerPosition`, `getPlpBalance`, `unredeemedBinaries` (keeper netting).
- **Builders** (unsigned) — `buildCreateManager`, `buildDeposit`, `buildMint`, `buildRedeem`, `buildRedeemPermissionless`, `buildMintRange`, `buildRedeemRange`, `buildSupply`, `buildWithdraw`, plus agent-wallet (`buildCreatePolicy/TopUp/Revoke/ReturnFunds/AgentTrade`) and tournament builders.
- **Helpers** — `assertTradable`, `mapExecutionError` (protocol aborts → human messages).

## Units (gotchas)

- dUSDC & PLP are **6 decimals**; `1 dUSDC = 1_000_000`. Quantity `1_000_000` = 1 contract = **$1 face value**.
- Prices are **1e9 fixed point** (`500_000_000` = $0.50 = 50% implied prob). Strikes are 1e9-scaled and must be a multiple of the oracle `tick_size`.
- `mint` takes **no `Coin`** — it spends the manager's internal balance, so `deposit` first.
- SVI is **total variance** (binary UP `= N(d2)`), not Black-Scholes `IV·√T`. See `@nanawise/shared`.

## License

MIT
