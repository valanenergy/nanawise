import 'dotenv/config';
import { AgentRunner } from './agent.js';
import { buildKeeperDeps } from './clients.js';
import { startCopyTradeWatcher } from './copytrade.js';
import { loadKeeperConfig } from './env.js';
import { startSignalCron } from './signal.js';
import { runWatcher } from './watcher.js';

/**
 * Keeper entrypoint (Phase 3): watch oracle events, auto-redeem settled binaries,
 * enqueue settlement DMs. The agent loop (Phase 4) hooks onActivated here later.
 */
async function main() {
  const cfg = loadKeeperConfig();
  const deps = buildKeeperDeps(cfg);
  if (deps.keeper) {
    const addr = deps.keeper.getPublicKey().toSuiAddress();
    const bal = await deps.sui.getBalance({ owner: addr });
    console.log(`[keeper] gas wallet ${addr} — ${Number(bal.totalBalance) / 1e9} SUI`);
  } else {
    console.warn('[keeper] no KEEPER_PRIVATE_KEY set — running in watch-only mode (no redeems)');
  }

  const agent = new AgentRunner(deps);
  if (deps.agent && deps.cfg.predict.agentPolicyPackageId) {
    console.log(`[agent] enabled — ${deps.agent.getPublicKey().toSuiAddress()}`);
  } else {
    console.warn('[agent] disabled (need AGENT_PRIVATE_KEY + AGENT_POLICY_PACKAGE_ID)');
  }

  await runWatcher(deps, {
    onActivated: (oracleId) => agent.onOracleActivated(oracleId),
  });
  startSignalCron(deps);
  startCopyTradeWatcher(deps);
  console.log('[keeper] running');
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
