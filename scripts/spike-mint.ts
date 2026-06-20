/**
 * Phase 0 protocol spike (NOT shipped). Proves the DeepBook Predict integration
 * end-to-end on testnet with a plain keypair, before any UI exists:
 *
 *   fund-check → create_manager → deposit → preview → mint → read back position
 *
 * Funding is manual: request dUSDC for the printed address via the faucet form
 * (https://tally.so/r/Xx102L), then re-run. Discovered values (manager id, oracle,
 * strike, expiry) can be pinned via env between runs to make the script idempotent.
 *
 * Run: pnpm spike
 * Env overrides: MANAGER_ID, ORACLE_ID, EXPIRY_MS, STRIKE_1E9, IS_UP, QUANTITY, DEPOSIT
 */
import 'dotenv/config';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { formatUsdc, loadConfig, OracleStatus, ORACLE_STALENESS_MS, USDC_SCALING } from '@nanawise/shared';
import { PredictClient } from '@nanawise/predict-sdk';

const EXPLORER = (digest: string) => `https://testnet.suivision.xyz/txblock/${digest}`;

function envBig(name: string): bigint | undefined {
  const v = process.env[name];
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined;
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.devPrivateKey) throw new Error('DEV_PRIVATE_KEY missing in .env');

  const { secretKey } = decodeSuiPrivateKey(cfg.devPrivateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const address = keypair.getPublicKey().toSuiAddress();

  const sui = new SuiJsonRpcClient({ url: cfg.rpcUrl, network: cfg.network });
  const predict = new PredictClient(sui, cfg);

  console.log('▶ spike address:', address);

  // 1. Fund check ----------------------------------------------------------------
  const [suiBal, dusdcBal] = await Promise.all([
    sui.getBalance({ owner: address }),
    sui.getBalance({ owner: address, coinType: cfg.dusdcType }),
  ]);
  console.log(`  SUI gas:   ${Number(suiBal.totalBalance) / 1e9}`);
  console.log(`  dUSDC:     ${formatUsdc(BigInt(dusdcBal.totalBalance), 6)}`);
  if (BigInt(suiBal.totalBalance) === 0n) {
    console.log('\n⚠ No SUI for gas. Fund this address with testnet SUI, then re-run.');
    console.log(`  Faucet: https://faucet.sui.io  (address: ${address})`);
    return;
  }
  if (BigInt(dusdcBal.totalBalance) === 0n) {
    console.log('\n⚠ No dUSDC. Request via the faucet form, then re-run.');
    console.log(`  dUSDC faucet: https://tally.so/r/Xx102L  (address: ${address})`);
    return;
  }

  // 2. Ensure a manager ----------------------------------------------------------
  let managerId = process.env.MANAGER_ID;
  if (!managerId) {
    console.log('\n▶ create_manager …');
    const tx = predict.buildCreateManager();
    const res = await sui.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showObjectChanges: true, showEffects: true },
    });
    await predict.waitFor(res.digest);
    managerId = await predict.findCreatedManagerId(res.digest);
    if (!managerId) throw new Error('could not find created PredictManager id in effects');
    console.log(`  manager: ${managerId}`);
    console.log(`  tx: ${EXPLORER(res.digest)}`);
    console.log(`  → pin MANAGER_ID=${managerId} in .env to reuse`);
  } else {
    console.log(`\n▶ reusing manager ${managerId}`);
  }

  // 3. Discover an oracle + market ----------------------------------------------
  let oracleId = process.env.ORACLE_ID;
  if (!oracleId) {
    console.log('\n▶ discovering oracles via predict-server …');
    try {
      const oracles = await predict.getOracles();
      console.log(`  found ${oracles.length} oracle(s):`);
      for (const o of oracles.slice(0, 8)) console.log(`   - ${o.oracleId} ${o.underlyingAsset ?? ''}`);
      oracleId = oracles.find((o) => /btc/i.test(o.underlyingAsset ?? ''))?.oracleId ?? oracles[0]?.oracleId;
    } catch {
      console.log('  (server probe failed; inspecting raw /oracles)');
      console.log(JSON.stringify(await predict.server.rawGet('/oracles'), null, 2).slice(0, 1500));
    }
  }
  if (!oracleId) {
    console.log('\n⚠ No oracle id. Set ORACLE_ID in .env (see raw output above) and re-run.');
    return;
  }

  const state = await predict.getOracleState(oracleId);
  console.log(`\n▶ oracle ${oracleId}`);
  console.log(`  status: ${OracleStatus[state.status]}  spot(1e9): ${state.spot1e9}  expiry: ${state.expiryMs}`);
  const ageMs = state.timestampMs ? Date.now() - state.timestampMs : Infinity;
  if (state.status !== OracleStatus.ACTIVE) {
    console.log('⚠ oracle not ACTIVE — wait for a fresh cycle (OracleActivated) and re-run.');
    return;
  }
  if (ageMs > ORACLE_STALENESS_MS) {
    console.log(`⚠ oracle stale (${ageMs}ms > ${ORACLE_STALENESS_MS}ms). Re-run when fresh.`);
  }

  // strike/expiry/direction — pin via env, else default ATM (spot) UP
  const expiry = envBig('EXPIRY_MS') ?? BigInt(state.expiryMs);
  const strike = envBig('STRIKE_1E9') ?? state.forward1e9 ?? state.spot1e9;
  const isUp = process.env.IS_UP ? process.env.IS_UP === 'true' : true;
  const quantity = envBig('QUANTITY') ?? USDC_SCALING; // 1 contract = $1 face value
  const depositAmount = envBig('DEPOSIT') ?? 2n * USDC_SCALING; // 2 dUSDC buffer
  const market = { oracleId, expiry, strike, isUp };
  console.log(`  market: strike(1e9)=${strike} expiry=${expiry} ${isUp ? 'UP' : 'DOWN'} qty=${quantity}`);

  // 4. Preview -------------------------------------------------------------------
  console.log('\n▶ get_trade_amounts (preview) …');
  let preview;
  try {
    preview = await predict.previewMint({ ...market, quantity }, address);
    console.log(`  mint_cost: ${formatUsdc(preview.cost, 6)} dUSDC  redeem_payout: ${formatUsdc(preview.payout, 6)}`);
    console.log(`  implied prob: ${(preview.impliedProb * 100).toFixed(2)}%`);
  } catch (e) {
    console.log(`⚠ preview failed: ${(e as Error).message}`);
    console.log('  Likely an invalid strike (not on the grid) or stale/expired oracle.');
    console.log('  Pin a valid STRIKE_1E9/EXPIRY_MS (inspect oracle state raw below) and re-run.');
    console.log(JSON.stringify(state.raw, null, 2).slice(0, 1500));
    return;
  }

  // 5. Deposit (mint spends the manager's INTERNAL balance) -----------------------
  const internal = await predict.getManagerBalance(managerId, cfg.dusdcType, address);
  console.log(`\n  manager internal balance: ${formatUsdc(internal, 6)} dUSDC`);
  if (internal < preview.cost) {
    const need = depositAmount > preview.cost ? depositAmount : preview.cost + USDC_SCALING;
    console.log(`▶ deposit ${formatUsdc(need, 6)} dUSDC into manager …`);
    const tx = predict.buildDeposit({ managerId, coinType: cfg.dusdcType, amount: need });
    const res = await sui.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    await predict.waitFor(res.digest);
    console.log(`  deposit tx: ${EXPLORER(res.digest)}`);
  }

  // 6. Mint ----------------------------------------------------------------------
  console.log('\n▶ mint …');
  const mintTx: Transaction = predict.buildMint({ managerId, ...market, quantity });
  const mintRes = await sui.signAndExecuteTransaction({
    signer: keypair,
    transaction: mintTx,
    options: { showEffects: true, showEvents: true },
  });
  await predict.waitFor(mintRes.digest);
  console.log(`  mint tx: ${EXPLORER(mintRes.digest)}`);

  // 7. Read back -----------------------------------------------------------------
  const qty = await predict.getManagerPosition(managerId, market, address);
  const balAfter = await predict.getManagerBalance(managerId, cfg.dusdcType, address);
  console.log(`\n✅ position quantity held: ${qty} (expected ${quantity})`);
  console.log(`   manager balance after: ${formatUsdc(balAfter, 6)} dUSDC`);
  if (qty < quantity) console.log('⚠ position quantity below expected — investigate.');
  else console.log('   Spike confirmed: real mint signature, 6-decimal units, table-quantity position.');
}

main().catch((e) => {
  console.error('\n✖ spike failed:', e);
  process.exit(1);
});
