# 04 — On-Chain Agent Wallet Design

This is the redesign forced by the validity audit (`01 §2.1`): a third-party keypair **cannot** trade on a user's `PredictManager`, because every entry point asserts `ctx.sender() == manager.owner()` and the manager's delegation caps are private. The original `AgentPolicy.execute_with_policy(sender==agent)` + `predict::mint(sender==owner)` design is impossible.

## Core idea: agent-owned manager + budget escrow

- The agent runs as a backend process with its **own Sui keypair** and its **own `PredictManager`** (the agent is the owner → its `mint` calls pass the owner check).
- A custom `AgentPolicy` Move object **custodies the user's dUSDC budget** and releases funds **per trade**, only to the agent, only while valid. The release happens *inside the same PTB* as the mint.
- Because the budget physically lives in the escrow, the agent **can never spend more than `budget_remaining`** — enforced by the Move VM, not the server. The user can `revoke` and **instantly reclaim** all unspent funds.

This yields a genuinely trustless agent wallet and a clean demo: show the policy object on-chain, watch budget decrement per trade, then `revoke` and watch the funds return and trading stop.

## Trust properties

| Property | How it's enforced |
|---|---|
| Agent cannot exceed budget | Escrow holds the funds; `request_funds` aborts if `remaining < amount`; can't conjure dUSDC |
| Owner can revoke instantly | `revoke` (owner-only) sets `revoked=true` and returns the escrow balance; subsequent `request_funds` aborts |
| Agent authorization expires | `request_funds` aborts if `epoch > expiry_epoch` |
| Only the designated agent can pull | `request_funds` asserts `sender == policy.agent` |
| Every action is auditable | `activity_log::ActionExecuted` emitted in the same PTB |
| Honest scope | The agent trades **its own** manager; user funds only ever move via the escrow's checked release; profits swept back to the user |

> **Honesty note for judges:** enforcement covers *budget, expiry, agent identity, and revocation*. It does not force the agent to trade well or to route *all* logic through Move — the strategy lives off-chain. We state this plainly. The on-chain guarantees are exactly the four bullets the Agentic Web sub-track asks for.

## `agent_policy` Move module

```move
module agent_policy::agent_policy {
    use sui::object::{Self, UID};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};

    /// Custodies a user's agent budget in `Quote` (dUSDC) and releases it per-trade to the agent.
    public struct AgentPolicy<phantom Quote> has key {
        id: UID,
        owner: address,            // user (zkLogin address) — only one who can revoke/top-up
        agent: address,            // backend agent keypair — only one who can pull funds
        escrow: Balance<Quote>,    // remaining budget, physically held here
        budget_cap: u64,           // original cap (for display)
        spent: u64,                // cumulative released
        expiry_epoch: u64,         // authorization expires at this epoch
        revoked: bool,
        strategy: vector<u8>,      // chosen strategy label (display/audit only)
    }

    const ENotOwner: u64 = 0;
    const ENotAgent: u64 = 1;
    const ERevoked: u64 = 2;
    const EExpired: u64 = 3;
    const EInsufficient: u64 = 4;

    /// User creates the policy and funds the escrow in one call (deposits a dUSDC coin).
    public fun create_policy<Quote>(
        agent: address, expiry_epoch: u64, strategy: vector<u8>,
        funding: Coin<Quote>, ctx: &mut TxContext,
    ): ID {
        let cap = coin::value(&funding);
        let policy = AgentPolicy<Quote> {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            agent,
            escrow: coin::into_balance(funding),
            budget_cap: cap, spent: 0, expiry_epoch, revoked: false, strategy,
        };
        let id = object::id(&policy);
        transfer::share_object(policy);
        id
    }

    /// Owner adds more budget.
    public fun top_up<Quote>(policy: &mut AgentPolicy<Quote>, funding: Coin<Quote>, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        policy.budget_cap = policy.budget_cap + coin::value(&funding);
        balance::join(&mut policy.escrow, coin::into_balance(funding));
    }

    /// Agent pulls exactly `amount` for a trade. Enforces ALL constraints in-VM.
    /// Returns a Coin the caller deposits into the agent's PredictManager (same PTB).
    public fun request_funds<Quote>(
        policy: &mut AgentPolicy<Quote>, amount: u64, clock: &Clock, ctx: &mut TxContext,
    ): Coin<Quote> {
        assert!(tx_context::sender(ctx) == policy.agent, ENotAgent);
        assert!(!policy.revoked, ERevoked);
        assert!(tx_context::epoch(ctx) <= policy.expiry_epoch, EExpired);
        assert!(balance::value(&policy.escrow) >= amount, EInsufficient);
        policy.spent = policy.spent + amount;
        coin::from_balance(balance::split(&mut policy.escrow, amount), ctx)
    }

    /// Owner revokes; returns ALL remaining escrow to the owner immediately.
    public fun revoke<Quote>(policy: &mut AgentPolicy<Quote>, ctx: &mut TxContext): Coin<Quote> {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        policy.revoked = true;
        let remaining = balance::value(&policy.escrow);
        coin::from_balance(balance::split(&mut policy.escrow, remaining), ctx)
    }

    /// Agent returns profits/unused funds to the policy for the owner to reclaim (optional path).
    public fun return_funds<Quote>(policy: &mut AgentPolicy<Quote>, coin: Coin<Quote>) {
        balance::join(&mut policy.escrow, coin::into_balance(coin));
    }

    // --- read accessors for the dashboard ---
    public fun budget_remaining<Quote>(p: &AgentPolicy<Quote>): u64 { balance::value(&p.escrow) }
    public fun spent<Quote>(p: &AgentPolicy<Quote>): u64 { p.spent }
    public fun is_revoked<Quote>(p: &AgentPolicy<Quote>): bool { p.revoked }
    public fun owner<Quote>(p: &AgentPolicy<Quote>): address { p.owner }
    public fun agent<Quote>(p: &AgentPolicy<Quote>): address { p.agent }
}
```

Design choices:
- **Generic over `Quote`** so it matches dUSDC and survives a quote-asset change.
- **Escrow holds real `Balance<Quote>`** — the cap is not a number to compare against, it is the funds that exist. This is what makes it un-bypassable.
- **`revoke` returns funds in the call** so revocation is atomic and instant.
- **Profit handling:** when the agent's settled positions pay out into the agent's manager, the agent withdraws and either re-deposits via `return_funds` (so the owner reclaims everything from one object) or sends directly to the user's manager. We choose `return_funds` for a single source of truth the dashboard reads.

## `activity_log` Move module

```move
module activity_log::activity_log {
    use sui::event;
    use sui::clock::{Self, Clock};

    public struct ActionExecuted has copy, drop {
        policy_id: ID, agent: address, owner: address,
        action_type: u8,        // 0 mint, 1 redeem, 2 mint_range, 3 return_funds, 4 leverage
        oracle_id: address, strike: u64, is_up: bool,
        quantity: u64, amount_spent: u64, budget_remaining: u64,
        strategy: vector<u8>, timestamp_ms: u64,
    }

    public fun emit_action(
        policy_id: ID, agent: address, owner: address, action_type: u8,
        oracle_id: address, strike: u64, is_up: bool, quantity: u64,
        amount_spent: u64, budget_remaining: u64, strategy: vector<u8>, clock: &Clock,
    ) {
        event::emit(ActionExecuted {
            policy_id, agent, owner, action_type, oracle_id, strike, is_up,
            quantity, amount_spent, budget_remaining, strategy,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }
}
```

## Refinements from the Phase 4 review (fold into the Move/keeper build)

- **Add lifecycle events.** Emit `PolicyCreated` and `PolicyRevoked` from `create_policy`/`revoke` so the dashboard and the keeper detect revocation with low latency (event subscription) instead of polling `getObject`. This is what makes the "next loop doesn't trade after revoke" acceptance fast and observable.
- **Budget meter = live escrow balance.** Because `top_up`/`return_funds` change the escrow without touching `budget_cap`/`spent`, the invariant `remaining = cap − spent` does **not** hold. The dashboard meter reads `budget_remaining() = balance::value(escrow)` directly; show `spent` and `cap` as informational.
- **Profit-sweep sequence (explicit).** On settlement of an agent position the keeper: (1) `redeem`/`redeem_permissionless` into the agent manager; (2) `predict_manager::withdraw<DUSDC>(amount)` (agent is owner → OK); (3) `agent_policy::return_funds(policy, coin)`. Sweep the **full** agent-manager dUSDC balance so nothing is stranded.
- **Revoke vs. unswept payouts.** `revoke` returns only the **escrow**; any payout still sitting in the agent manager's internal balance is not reclaimed by `revoke`. Resolution: the keeper forces a sweep (`return_funds`) at/just after revoke so the owner reclaims everything from the policy object. Document this in the `/revoke` flow.
- **Mirror trust.** `activity_log::emit_action` is permissionless (anyone can emit a forged `ActionExecuted`). The keeper's Postgres mirror **only** ingests `ActionExecuted` whose transaction sender == the policy's `agent`, cross-checked against on-chain state. Never trust the event blindly.
- **Access-control note.** `return_funds` is intentionally permissionless (funding-in is benign); `top_up` should `assert!(!revoked)` (or document that re-funding a revoked policy is intentional and only reclaimable via another `revoke`).
- **Oracle pre-flight in the loop.** Before building any agent PTB, the loop runs `assertTradable` (status ACTIVE, freshness <30s, not paused) and checks `ask_bounds`/exposure, to avoid burning agent gas on guaranteed-revert mints.

## The agent trade PTB

One atomic transaction, signed by the **agent** keypair:

```
PTB (sender = agent) {
  // request a BUFFERED amount — mint price is post-trade, so exact cost is unknown pre-call.
  // request_amount = ceil(previewCost * (1 + ε)), ε ≈ 1–2%.
  let funds   = agent_policy::request_funds<DUSDC>(policy, request_amount, clock)  // aborts if revoked/expired/over-budget
  predict_manager::deposit<DUSDC>(agent_manager, funds)                            // agent owns this manager → OK
  predict::mint<DUSDC>(predict, agent_manager, oracle, market_key, quantity, clock) // pulls the REAL cost from the manager's internal balance
  activity_log::emit_action(policy_id, agent, owner, 0, oracle_id, strike, is_up,
                            quantity, request_amount, agent_policy::budget_remaining(policy), strategy, clock)
}
```

Notes (from review):
- `mint` takes **no `Coin`** — it withdraws the real cost from the agent manager's internal balance (verified `predict.move:246`). So the order is `request_funds → deposit → mint`.
- Because the price is quoted post-trade, request `ceil(previewCost·(1+ε))`. If the real cost exceeds the buffered deposit, `mint`'s internal withdraw aborts and the whole PTB reverts safely (no spend). Any unspent residual stays as dust in the agent manager's internal balance and is swept back via `return_funds`.
- `amount_spent` logged = the amount **released from escrow** (`request_amount`), i.e. "budget consumed," not the trade cost. The true premium is read from the `PositionMinted.cost` event for PnL; the keeper reconciles the two in the Postgres mirror.

If `request_funds` aborts, the whole PTB reverts — no mint, no spend.

## Strategy loop (off-chain, `apps/keeper/src/agent.ts`)

- Trigger: `oracle::OracleActivated` event (new expiry cycle) or a periodic tick.
- For each active policy whose strategy is enabled and not revoked/expired:
  1. Read SVI via `getOracleSviLatest` and recent prices.
  2. Compute the strategy's target (see below); size = `min(per_trade_size, budget_remaining)`; default per-trade size = 10% of `budget_cap`.
  3. Preview cost with `get_trade_amounts`; check oracle freshness (<30s) and exposure.
  4. Build & submit the PTB above. Record `tx_hash` and the emitted event into Postgres.
- On settlement of an agent position: keeper redeems (it owns the manager) and calls `return_funds` to route value back to the policy.

### Strategies (systematic, not predictive)

**Pricing (verified — total variance, no time term):** the on-chain surface gives `w(k) = a + b·(ρ·(k−m) + √((k−m)² + σ²))`, `k = ln(K/F)`, and binary UP price `= N(d2)`, `d2 = -((k + w/2)/√w)`. All params are 1e9-scaled; `ρ, m` are signed. `shared/svi` mirrors this `N(d2)` form (do **not** use `IV·√T` — the feeder already scales variance to the tenor). `T` (from `expiry − now`, ms) is only needed by realized-vol estimators, not by the binary price.

Each strategy is a **pure function** `(svi, spot, forward, recentPrices, strikes, budget) → {strike, isUp, quantity}` so it is unit-testable:
- **vol-harvest** — for each available strike compute the model binary price (`N(d2)`) and a realized-probability estimate = lognormal prob from `stdev(last N hourly log-returns)` scaled to the tenor; buy the strike with the largest |model − realized| gap (tie-break: closest to ATM).
- **momentum** — if 1h BTC move > +0.5%, buy the nearest OTM-UP strike (first strike above spot); < −0.5%, nearest OTM-DOWN; else no trade.
- **contrarian** — if |1h move| > 1.5%, take the opposite side (mean reversion).
- **delta-neutral** — buy equal-quantity UP and DOWN at ±1% of spot; profits if BTC stays near spot (time-decay harvest).

## Margin leverage extension (Phase 8, demo slice)

For the leverage demo, the agent additionally opens **one** bounded leveraged spot position via DeepBook Margin (its own `MarginManager`, ≤2x, with on-chain TP/SL). The budget for it is pulled the same way (`request_funds`), and `action_type = 4 (leverage)` is logged. This is strictly opt-in and demo-scoped — see [`phases/phase-8-leverage-polish-launch.md`](./phases/phase-8-leverage-polish-launch.md).

## Bot/dashboard commands mapped to this design

| Command / UI | On-chain |
|---|---|
| `/policy <budget> <hours>` (Mini App signs) | `create_policy<DUSDC>(agent, expiry_epoch, strategy, funding_coin)` |
| top up | `top_up<DUSDC>(policy, funding_coin)` |
| `/auto <strategy>` / `/auto off` | off-chain enable/disable in Postgres (no tx) |
| `/revoke` (Mini App signs) | `revoke<DUSDC>(policy)` → returns funds, sets revoked |
| dashboard agent page | reads policy object + `ActionExecuted` events |
