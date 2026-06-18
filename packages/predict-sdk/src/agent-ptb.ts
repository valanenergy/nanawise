import { ActionType } from '@nanawise/shared';
import { coinWithBalance, Transaction } from '@mysten/sui/transactions';
import { marketKeyArg } from './ptb.js';
import type { AgentTradeParams, CreatePolicyParams, PredictSdkConfig } from './types.js';

/**
 * agent_policy / activity_log builders (Phase 4, docs/04). The agent owns its OWN
 * manager; the escrow releases budget per trade. The agent-trade PTB is one atomic
 * chain signed by the AGENT key:
 *   request_funds(buffered) → deposit → mint → emit_action
 * If request_funds aborts (revoked/expired/over-budget) the whole PTB reverts.
 */

function requirePkgs(cfg: PredictSdkConfig): { ap: string; al: string } {
  if (!cfg.agentPolicyPackageId || !cfg.activityLogPackageId) {
    throw new Error('agent_policy / activity_log package IDs not configured (deploy Move first)');
  }
  return { ap: cfg.agentPolicyPackageId, al: cfg.activityLogPackageId };
}

/** create_policy<Quote>(agent, expiry_epoch, strategy, funding) — signed by the OWNER. */
export function buildCreatePolicy(
  cfg: PredictSdkConfig,
  p: CreatePolicyParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const { ap } = requirePkgs(cfg);
  tx.moveCall({
    target: `${ap}::agent_policy::create_policy`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.pure.address(p.agent),
      tx.pure.u64(p.expiryEpoch),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(p.strategy))),
      coinWithBalance({ type: cfg.dusdcType, balance: p.fundingAmount }),
    ],
  });
  return tx;
}

/** top_up<Quote>(policy, funding) — OWNER. */
export function buildTopUp(
  cfg: PredictSdkConfig,
  p: { policyId: string; amount: bigint },
  tx: Transaction = new Transaction(),
): Transaction {
  const { ap } = requirePkgs(cfg);
  tx.moveCall({
    target: `${ap}::agent_policy::top_up`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.policyId), coinWithBalance({ type: cfg.dusdcType, balance: p.amount })],
  });
  return tx;
}

/** revoke<Quote>(policy) → returns remaining escrow to the OWNER; transfer it back. */
export function buildRevoke(
  cfg: PredictSdkConfig,
  p: { policyId: string; ownerAddress: string },
  tx: Transaction = new Transaction(),
): Transaction {
  const { ap } = requirePkgs(cfg);
  const coin = tx.moveCall({
    target: `${ap}::agent_policy::revoke`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.policyId)],
  });
  tx.transferObjects([coin], p.ownerAddress);
  return tx;
}

/** return_funds<Quote>(policy, coin) — sweep a coin back into the escrow (permissionless). */
export function buildReturnFunds(
  cfg: PredictSdkConfig,
  p: { policyId: string; amount: bigint },
  tx: Transaction = new Transaction(),
): Transaction {
  const { ap } = requirePkgs(cfg);
  tx.moveCall({
    target: `${ap}::agent_policy::return_funds`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.policyId), coinWithBalance({ type: cfg.dusdcType, balance: p.amount })],
  });
  return tx;
}

/**
 * The agent-trade PTB (signed by the AGENT key):
 *   funds = request_funds(policy, requestAmount, clock)
 *   deposit(agentManager, funds)
 *   mint(agentManager, key, quantity, clock)
 *   emit_action(policy_id, agent, owner, MINT, oracle, strike, isUp, qty, requestAmount, remaining, strategy, clock)
 */
export function buildAgentTrade(
  cfg: PredictSdkConfig,
  agentAddress: string,
  p: AgentTradeParams,
  tx: Transaction = new Transaction(),
): Transaction {
  const { ap, al } = requirePkgs(cfg);

  const funds = tx.moveCall({
    target: `${ap}::agent_policy::request_funds`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.policyId), tx.pure.u64(p.requestAmount), tx.object(cfg.clockId)],
  });

  tx.moveCall({
    target: `${cfg.predictPackageId}::predict_manager::deposit`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.agentManagerId), funds],
  });

  const key = marketKeyArg(tx, cfg, p);
  tx.moveCall({
    target: `${cfg.predictPackageId}::predict::mint`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictObjectId),
      tx.object(p.agentManagerId),
      tx.object(p.oracleId),
      key,
      tx.pure.u64(p.quantity),
      tx.object(cfg.clockId),
    ],
  });

  const remaining = tx.moveCall({
    target: `${ap}::agent_policy::budget_remaining`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(p.policyId)],
  });

  tx.moveCall({
    target: `${al}::activity_log::emit_action`,
    arguments: [
      tx.pure.id(p.policyId),
      tx.pure.address(agentAddress),
      tx.pure.address(p.ownerAddress),
      tx.pure.u8(ActionType.MINT),
      tx.pure.address(p.oracleId),
      tx.pure.u64(p.strike),
      tx.pure.bool(p.isUp),
      tx.pure.u64(p.quantity),
      tx.pure.u64(p.requestAmount),
      remaining,
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(p.strategy))),
      tx.object(cfg.clockId),
    ],
  });
  return tx;
}
