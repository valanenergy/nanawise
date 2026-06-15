# Phase 4 — On-Chain Agent Wallet & Strategies

**Goal:** Deploy the `agent_policy` escrow + `activity_log` Move packages, run the off-chain agent loop that trades the agent's own manager within the on-chain budget, and expose `/policy`, `/auto`, `/revoke` — with budget decrementing per trade and `/revoke` provably stopping the agent on-chain.

**Depends on:** Phase 2 (mint builders, SVI math), Phase 3 (watcher cycle events, redeem), Phase 1 (signing for policy create/revoke).

**This is the Agentic Web track deliverable.** Design rationale and full Move source: [`../04-agent-wallet-design.md`](../04-agent-wallet-design.md).

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 4) and the "Refinements from the Phase 4 review" section in `04` before building. Key corrections: cost buffer ε (post-trade pricing), escrow-as-meter, redeem→`return_funds` sweep + revoke reclaim, `PolicyCreated`/`PolicyRevoked` events, mirror-trust rule, verified SVI `N(d2)` total-variance pricing.

## Scope

**In:** the two Move packages (+ tests + testnet deploy), the agent loop with 4 strategies, the agent's keypair + `PredictManager`, profit sweep, bot `/policy`/`/auto`/`/revoke`, the SVI math library (full impl), the `AgentAction` event mirror.

**Out:** the agent dashboard page (Phase 5 wires the UI), margin leverage (Phase 8).

## Components

### Move — `move/agent_policy` & `move/activity_log`
- Implement exactly as `04` specifies (`create_policy`, `top_up`, `request_funds`, `revoke`, `return_funds`, read accessors; `emit_action`). Generic over `Quote`.
- **Move unit tests** (Sui test framework): budget decrements; over-budget `request_funds` aborts (`EInsufficient`); non-agent caller aborts (`ENotAgent`); revoked aborts (`ERevoked`); expired epoch aborts (`EExpired`); `revoke` returns the full remaining escrow and flips `revoked`; non-owner `revoke` aborts (`ENotOwner`).
- Build, publish to testnet, record `AGENT_POLICY_PACKAGE_ID` + `ACTIVITY_LOG_PACKAGE_ID` in env.

### `packages/shared/svi.ts` (full impl)
- `totalVariance(k, {a,b,rho,m,sigma})`, `impliedVol(K,F,T,params)`, `binaryUpPrice(K,F,T,params)` (normal CDF), `logMoneyness(K,F)`. Handle signed `rho,m`. Unit-tested against hand-computed values.

### `packages/predict-sdk` additions
- `buildAgentTrade({ policyId, agentManagerId, oracleId, key, quantity, mintCost, strategy })` → composes the one-PTB chain in `04` (`request_funds` → `deposit` → `mint` → `emit_action`) using `tx` composition.
- `buildCreatePolicy`, `buildTopUp`, `buildRevoke`, `buildReturnFunds`.
- `readAgentPolicy(id)` → parsed object state for the dashboard/bot.

### `apps/keeper/src/agent.ts`
- Owns the agent keypair; ensures a single agent `PredictManager` exists (create once).
- Loop trigger: `OracleActivated` (new cycle) + periodic safety tick.
- For each enabled, non-revoked, non-expired policy:
  1. Read SVI (`getOracleSviLatest`) + recent prices; compute the strategy target (`04` strategies).
  2. `size = min(perTradeSize, budgetRemaining)`; default `perTradeSize = 10% of budget_cap`.
  3. `previewMint` → `mintCost`; `assertTradable` (freshness/exposure).
  4. Submit `buildAgentTrade` signed by the agent key; on success, mirror the emitted `ActionExecuted` into Postgres `AgentAction` with `txHash`.
- **Profit sweep:** on settlement of an agent position (Phase 3 watcher), keeper redeems the agent manager, then `return_funds` to the policy so the owner reclaims via `revoke`/withdraw path.
- Strategy enable/disable state stored per policy in Postgres (no tx for `/auto`).

### Bot commands
- `/policy <budget> <hours>` — opens Mini App to sign `create_policy<DUSDC>(agent_addr, expiry_epoch, strategy, funding)`. The funding coin is `budget` dUSDC from the user's manager.
- `/auto <strategy>` / `/auto off` — set/clear the enabled strategy in Postgres; reply with current budget + expiry.
- `/revoke` — opens Mini App to sign `revoke<DUSDC>(policy)`; reply with the returned amount + TX link; show "agent can no longer trade."

## Acceptance criteria
- `agent_policy`/`activity_log` deployed to testnet; package IDs in env; Move tests green (each abort path proven).
- A user creates a policy (real TX funding the escrow), enables `vol-harvest`, and the agent autonomously executes **≥3 trades across cycles**, each: pulling from the escrow (budget visibly decrements on-chain), minting into the agent manager, and emitting an `ActionExecuted` event mirrored to Postgres with a TX hash.
- An attempt to trade beyond `budget_remaining` aborts on-chain (demonstrated).
- `/revoke` produces an on-chain TX that flips `revoked=true`, returns the unspent escrow to the user, and the next agent loop iteration **does not trade** (the PTB aborts if attempted) — verifiable on the explorer.
- Agent profits from a settled position are returned to the policy (sweep verified).

## Test plan
- Move: the full abort matrix above.
- Unit (TS): SVI math vs known values; each strategy's strike selection given fixed SVI/price inputs; PTB composition shape.
- Integration: create policy → run loop on testnet → assert ≥3 `ActionExecuted` events + budget decrement; then `revoke` → assert funds returned + subsequent trade aborts.
- Security: simulate a "rogue agent" trying `request_funds` after revoke / beyond budget → both abort.

## Risks
| Risk | Mitigation |
|---|---|
| Move bug in escrow | Keep module minimal; exhaustive unit tests; the abort matrix is the spec |
| Agent manager profit custody confusion | Single `return_funds` path → owner reclaims from one object; documented |
| No active cycle during demo | Periodic tick + pre-armed policy; captured run as fallback |
| Strategy makes a bad trade live | Budget cap bounds loss; conservative `perTradeSize`; demo uses a small budget |
| Epoch expiry vs `expiry_epoch` confusion | Compute `expiry_epoch` from `hours`/epoch length; show countdown |
