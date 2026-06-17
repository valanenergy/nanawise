/// agent_policy — custodies a user's agent trading budget in `Quote` (dUSDC) and
/// releases it per-trade to the agent, enforcing budget / expiry / agent-identity /
/// revocation in the Move VM. See docs/04-agent-wallet-design.md.
///
/// Trust model: the escrow physically holds the funds, so the agent can never spend
/// more than `budget_remaining`; the owner can `revoke` and reclaim all unspent funds
/// atomically. The agent trades its OWN PredictManager (owner check passes there).
module agent_policy::agent_policy;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

const ENotOwner: u64 = 0;
const ENotAgent: u64 = 1;
const ERevoked: u64 = 2;
const EExpired: u64 = 3;
const EInsufficient: u64 = 4;

/// Shared escrow object. Generic over `Quote` so it survives a quote-asset change.
public struct AgentPolicy<phantom Quote> has key {
    id: UID,
    owner: address, // user (zkLogin address) — only one who can revoke / top-up
    agent: address, // backend agent keypair — only one who can pull funds
    escrow: Balance<Quote>, // remaining budget, physically held here
    budget_cap: u64, // cumulative funded (display only; NOT an invariant vs escrow)
    spent: u64, // cumulative released to the agent
    expiry_epoch: u64, // authorization expires at this epoch
    revoked: bool,
    strategy: vector<u8>, // chosen strategy label (display / audit only)
}

public struct PolicyCreated has copy, drop {
    policy_id: ID,
    owner: address,
    agent: address,
    budget_cap: u64,
    expiry_epoch: u64,
}

public struct PolicyRevoked has copy, drop {
    policy_id: ID,
    owner: address,
    returned: u64,
}

/// User creates the policy and funds the escrow in one call.
public fun create_policy<Quote>(
    agent: address,
    expiry_epoch: u64,
    strategy: vector<u8>,
    funding: Coin<Quote>,
    ctx: &mut TxContext,
): ID {
    let cap = funding.value();
    let owner = ctx.sender();
    let policy = AgentPolicy<Quote> {
        id: object::new(ctx),
        owner,
        agent,
        escrow: funding.into_balance(),
        budget_cap: cap,
        spent: 0,
        expiry_epoch,
        revoked: false,
        strategy,
    };
    let id = object::id(&policy);
    event::emit(PolicyCreated { policy_id: id, owner, agent, budget_cap: cap, expiry_epoch });
    transfer::share_object(policy);
    id
}

/// Owner adds more budget. Disallowed once revoked (re-fund a fresh policy instead).
public fun top_up<Quote>(policy: &mut AgentPolicy<Quote>, funding: Coin<Quote>, ctx: &TxContext) {
    assert!(ctx.sender() == policy.owner, ENotOwner);
    assert!(!policy.revoked, ERevoked);
    policy.budget_cap = policy.budget_cap + funding.value();
    policy.escrow.join(funding.into_balance());
}

/// Agent pulls exactly `amount` for a trade — enforces ALL constraints in-VM.
/// The caller deposits the returned Coin into the agent's PredictManager in the same PTB.
/// (`_clock` is accepted for signature stability; expiry is checked against the epoch.)
public fun request_funds<Quote>(
    policy: &mut AgentPolicy<Quote>,
    amount: u64,
    _clock: &Clock,
    ctx: &mut TxContext,
): Coin<Quote> {
    assert!(ctx.sender() == policy.agent, ENotAgent);
    assert!(!policy.revoked, ERevoked);
    assert!(ctx.epoch() <= policy.expiry_epoch, EExpired);
    assert!(policy.escrow.value() >= amount, EInsufficient);
    policy.spent = policy.spent + amount;
    coin::from_balance(policy.escrow.split(amount), ctx)
}

/// Owner revokes; returns ALL remaining escrow to the owner immediately.
public fun revoke<Quote>(policy: &mut AgentPolicy<Quote>, ctx: &mut TxContext): Coin<Quote> {
    assert!(ctx.sender() == policy.owner, ENotOwner);
    policy.revoked = true;
    let remaining = policy.escrow.value();
    let out = coin::from_balance(policy.escrow.split(remaining), ctx);
    event::emit(PolicyRevoked {
        policy_id: object::id(policy),
        owner: policy.owner,
        returned: remaining,
    });
    out
}

/// Agent returns profits / unused funds to the policy for the owner to reclaim.
/// Intentionally permissionless (funding-in is benign).
public fun return_funds<Quote>(policy: &mut AgentPolicy<Quote>, coin: Coin<Quote>) {
    policy.escrow.join(coin.into_balance());
}

// --- read accessors for the dashboard / keeper ---
/// Live budget meter = escrow balance (authoritative; cap−spent is NOT invariant).
public fun budget_remaining<Quote>(p: &AgentPolicy<Quote>): u64 { p.escrow.value() }

public fun spent<Quote>(p: &AgentPolicy<Quote>): u64 { p.spent }

public fun budget_cap<Quote>(p: &AgentPolicy<Quote>): u64 { p.budget_cap }

public fun expiry_epoch<Quote>(p: &AgentPolicy<Quote>): u64 { p.expiry_epoch }

public fun is_revoked<Quote>(p: &AgentPolicy<Quote>): bool { p.revoked }

public fun owner<Quote>(p: &AgentPolicy<Quote>): address { p.owner }

public fun agent<Quote>(p: &AgentPolicy<Quote>): address { p.agent }

public fun strategy<Quote>(p: &AgentPolicy<Quote>): vector<u8> { p.strategy }
