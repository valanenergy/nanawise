import { prisma } from '@nanawise/db';
import {
  ACTION_TYPE_LABEL,
  ActionType,
  descaleSvi,
  OracleStatus,
  runStrategy,
  type StrategyContext,
  type StrategyName,
} from '@nanawise/shared';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { OracleState } from '@nanawise/predict-sdk';
import type { KeeperDeps } from './clients.js';

/**
 * Off-chain agent loop (Phase 4, docs/04). The agent owns its own PredictManager and
 * trades within the on-chain budget escrow. Triggered on OracleActivated (new cycle)
 * + a periodic tick. Every constraint (budget/expiry/agent/revoke) is enforced IN
 * MOVE by request_funds — this loop only decides what to trade.
 *
 * Enabled strategy per policy is stored in Postgres (User.agentPolicyId + a strategy
 * flag); `/auto` toggles it with no tx.
 */
const ε_NUM = 102n; // 1.02 → ~2% cost buffer (post-trade pricing)
const ε_DEN = 100n;

export class AgentRunner {
  private agentManagerId?: string;

  constructor(private readonly deps: KeeperDeps) {}

  get key(): Ed25519Keypair | undefined {
    return this.deps.agent;
  }

  /** Ensure the agent has exactly one PredictManager (create once, cache id). */
  async ensureManager(): Promise<string | undefined> {
    if (!this.deps.agent) return undefined;
    if (this.agentManagerId) return this.agentManagerId;
    const cached = await this.deps.redis.get('agent:manager_id');
    if (cached) {
      this.agentManagerId = cached;
      return cached;
    }
    const tx = this.deps.predict.buildCreateManager();
    const res = await this.deps.sui.signAndExecuteTransaction({
      signer: this.deps.agent,
      transaction: tx,
      options: { showObjectChanges: true },
    });
    await this.deps.sui.waitForTransaction({ digest: res.digest });
    const mgr = await this.deps.predict.findCreatedManagerId(res.digest);
    if (mgr) {
      this.agentManagerId = mgr;
      await this.deps.redis.set('agent:manager_id', mgr);
    }
    return mgr;
  }

  /** Run all enabled policies against the freshly-activated oracle. */
  async onOracleActivated(oracleId: string): Promise<void> {
    if (!this.deps.agent) return;
    const state = await this.deps.predict.getOracleState(oracleId);
    if (state.status !== OracleStatus.ACTIVE) return;

    const agentManagerId = await this.ensureManager();
    if (!agentManagerId) return;

    // Enabled policies: users with an agentPolicyId + a non-empty strategy flag in Redis.
    const users = await prisma.user.findMany({ where: { agentPolicyId: { not: null } } });
    for (const u of users) {
      const strategy = (await this.deps.redis.get(`agent:strategy:${u.agentPolicyId}`)) as StrategyName | null;
      if (!strategy) continue;
      try {
        await this.tradePolicy(u.agentPolicyId!, strategy, state, agentManagerId);
      } catch (e) {
        console.error(`[agent] policy ${u.agentPolicyId} trade failed:`, (e as Error).message);
      }
    }
  }

  private async tradePolicy(
    policyId: string,
    strategy: StrategyName,
    state: OracleState,
    agentManagerId: string,
  ): Promise<void> {
    const policy = await this.deps.predict.readAgentPolicy(policyId);
    if (policy.revoked) return;
    const epoch = Number((await this.deps.sui.getLatestSuiSystemState()).epoch);
    if (BigInt(epoch) > policy.expiryEpoch) return;
    if (policy.budgetRemaining <= 0n) return;

    // Build the strategy context.
    const forward = Number(state.forward1e9) / 1e9;
    const spot = Number(state.spot1e9) / 1e9;
    const FIVE = 500_000_000_000n;
    const base = (state.forward1e9 / FIVE) * FIVE;
    const strikes: number[] = [];
    for (let i = -4; i <= 4; i++) {
      const s = base + BigInt(i) * FIVE;
      if (s > 0n) strikes.push(Number(s) / 1e9);
    }
    const recentReturns = await this.recentReturns(state.oracleId);
    const perTradeSize = policy.budgetCap / 10n; // 10% of cap per trade

    const ctx: StrategyContext = {
      spot,
      forward,
      svi: state.svi ? descaleSvi(state.svi) : { a: 0, b: 0, rho: 0, m: 0, sigma: 0 },
      recentReturns,
      strikes,
      budgetRemaining: policy.budgetRemaining,
      perTradeSize: perTradeSize > 0n ? perTradeSize : policy.budgetRemaining,
    };

    const decisions = runStrategy(strategy, ctx);
    for (const d of decisions) {
      const strike1e9 = BigInt(Math.round(d.strike)) * 1_000_000_000n;
      try {
        this.deps.predict.assertTradable(state);
        const pv = await this.deps.predict.previewMint(
          { oracleId: state.oracleId, expiry: BigInt(state.expiryMs), strike: strike1e9, isUp: d.isUp, quantity: d.quantity },
          this.deps.agent!.getPublicKey().toSuiAddress(),
        );
        const requestAmount = (pv.cost * ε_NUM) / ε_DEN + 1n;
        if (requestAmount > policy.budgetRemaining) {
          console.log(`[agent] ${policyId}: insufficient budget for ${strategy} leg, skipping`);
          continue;
        }
        const tx = this.deps.predict.buildAgentTrade(this.deps.agent!.getPublicKey().toSuiAddress(), {
          policyId,
          agentManagerId,
          oracleId: state.oracleId,
          expiry: BigInt(state.expiryMs),
          strike: strike1e9,
          isUp: d.isUp,
          quantity: d.quantity,
          requestAmount,
          ownerAddress: policy.owner,
          strategy,
        });
        const res = await this.deps.sui.signAndExecuteTransaction({
          signer: this.deps.agent!,
          transaction: tx,
          options: { showEffects: true },
        });
        await this.deps.sui.waitForTransaction({ digest: res.digest });
        await this.mirrorAction(policyId, policy.owner, strategy, state.oracleId, strike1e9, d.isUp, d.quantity, requestAmount, res.digest);
        console.log(`[agent] ${policyId}: ${strategy} ${d.isUp ? 'UP' : 'DOWN'} $${d.strike} tx ${res.digest.slice(0, 10)}…`);
      } catch (e) {
        console.error(`[agent] ${policyId} leg aborted:`, this.deps.predict.mapExecutionError((e as Error).message));
      }
    }
  }

  /** Mirror the on-chain ActionExecuted into Postgres (trust = tx signed by the agent). */
  private async mirrorAction(
    policyId: string,
    owner: string,
    strategy: string,
    oracleId: string,
    strike: bigint,
    isUp: boolean,
    quantity: bigint,
    amountSpent: bigint,
    txHash: string,
  ): Promise<void> {
    const policy = await this.deps.predict.readAgentPolicy(policyId).catch(() => null);
    await prisma.agentAction.create({
      data: {
        policyId,
        ownerAddress: owner,
        strategy,
        actionType: ACTION_TYPE_LABEL[ActionType.MINT],
        oracleId,
        strike,
        isUp,
        quantity,
        amountSpent,
        budgetRemaining: policy?.budgetRemaining ?? null,
        txHash,
      },
    });
  }

  /** Hourly log-returns from the oracle price history (server), newest last. */
  private async recentReturns(oracleId: string): Promise<number[]> {
    try {
      const raw = await this.deps.predict.server.rawGet(`/oracles/${oracleId}/prices`);
      const r = raw as { json?: unknown };
      const arr = Array.isArray(r.json) ? r.json : [];
      const spots = arr
        .map((p) => Number((p as Record<string, unknown>).spot ?? 0))
        .filter((n) => n > 0)
        .slice(-25);
      const returns: number[] = [];
      for (let i = 1; i < spots.length; i++) returns.push(Math.log(spots[i]! / spots[i - 1]!));
      return returns;
    } catch {
      return [];
    }
  }
}
