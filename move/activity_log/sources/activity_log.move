/// activity_log — emits an auditable `ActionExecuted` event in the same PTB as an
/// agent trade. See docs/04-agent-wallet-design.md.
///
/// NOTE: emission is permissionless. The keeper's Postgres mirror MUST only ingest
/// events whose transaction sender == the policy's agent (cross-checked on-chain).
/// Never trust a raw event.
module activity_log::activity_log;

use sui::clock::Clock;
use sui::event;

/// action_type: 0 mint, 1 redeem, 2 mint_range, 3 return_funds, 4 leverage, 5 copy
public struct ActionExecuted has copy, drop {
    policy_id: ID,
    agent: address,
    owner: address,
    action_type: u8,
    oracle_id: address,
    strike: u64,
    is_up: bool,
    quantity: u64,
    amount_spent: u64, // amount RELEASED from escrow (budget consumed), not the trade premium
    budget_remaining: u64,
    strategy: vector<u8>,
    timestamp_ms: u64,
}

public fun emit_action(
    policy_id: ID,
    agent: address,
    owner: address,
    action_type: u8,
    oracle_id: address,
    strike: u64,
    is_up: bool,
    quantity: u64,
    amount_spent: u64,
    budget_remaining: u64,
    strategy: vector<u8>,
    clock: &Clock,
) {
    event::emit(ActionExecuted {
        policy_id,
        agent,
        owner,
        action_type,
        oracle_id,
        strike,
        is_up,
        quantity,
        amount_spent,
        budget_remaining,
        strategy,
        timestamp_ms: clock.timestamp_ms(),
    });
}
