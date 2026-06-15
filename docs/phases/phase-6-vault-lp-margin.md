# Phase 6 — Vault / LP + Margin Lending

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 6) before building. Key corrections: PLP is a **user-held coin** (not in the manager); "What If" math + golden test specified; withdraw limiter math (`min(available, bucketFill)`); margin lending gated on confirmed IDs+signatures; no over-claim on interest.

**Goal:** Complete the liquidity-provider flow (`supply`/`withdraw` PLP with the withdrawal limiter and a "What If" simulator) and add the **DeepBook Margin dUSDC lending pool** so idle balances earn on-chain yield — the DeFi & Payments story.

**Depends on:** Phase 2 (SDK + signing), Phase 5 (vault page shell).

## Scope

**In:** `supply`/`withdraw` builders + bot `/vault /supply /withdraw`, the vault page forms + withdrawal-limiter UI + "What If" simulator, and a `MarginPool<DUSDC>` lending integration (supply/withdraw, `SupplierCap`, APY display).

**Out:** agent leverage (Phase 8), borrowing/liquidation of any kind, margin-on-Predict (out of scope entirely per `01 §4`).

## Part A — PLP Vault

### Validated facts (`03`)
- `supply<Quote>(predict, coin, clock, ctx): Coin<PLP>` — first depositor 1:1, then pro-rata of vault value. `withdraw<Quote>(predict, lp_coin, clock, ctx): Coin<Quote>` — gated by available balance (vault balance minus max-payout coverage) and a **token-bucket withdrawal limiter** (`RateLimiter` on `Predict`). PLP is a real 6-decimal `Coin`.

### Components
- `predict-sdk`: `buildSupply`, `buildWithdraw`; `previewSupply(amount)` (expected PLP via vault value-per-share from `/vault/summary`); `previewWithdraw(plp)` (expected dUSDC + check available + limiter state).
- Bot: `/vault` (utilization, PLP balance≈dUSDC, 7d return, withdrawal-available), `/supply <amount>` (confirm → sign), `/withdraw <amount>` (check available; if capped by coverage/limiter, offer the max available).
- Vault page (extends Phase 5): supply form (shows expected PLP), withdraw form (shows payout + available + limiter), user PLP balance + share of vault, **"What If" simulator** (JS only: input a hypothetical BTC move → recompute MTM liability from current SVI + vault state → estimated PLP price impact + whether exposure limit would trip).
- Withdrawal-limiter UI: bucket capacity, current fill, refill rate, plain-language "Up to X dUSDC withdrawable now; refills at Y/hour."

## Part B — Margin dUSDC Lending

### Validated facts (`01 §4`)
- DeepBook Margin `MarginPool<Asset>` is a single-asset lending pool: `supply`/`withdraw` with a transferable `SupplierCap`; lenders earn borrower interest; Pyth-priced (matters for the borrow/liquidation side, **not** for pure supply). No Predict↔Margin link exists — this is a clean, low-risk standalone lending integration.
- ⚠️ Margin packages were found on the repo `main` branch, not `predict-testnet-4-16`. **First task: confirm the deployed testnet `MarginPool<DUSDC>` object + package IDs** (or whether we must deploy/point at one) and put them in env. If no suitable testnet pool exists, scope Part B to a thin demo against whatever pool is available, or defer Part B to Phase 8.

### Components
- `predict-sdk` (or a small `margin` module): `buildMarginSupply(amount)`, `buildMarginWithdraw(supplierCapId)`, `getMarginPoolState()` (APY, utilization), `readSupplierCap(id)`.
- Bot: `/earn` (or extend `/vault`) — "your idle dUSDC is earning X% APY," supply/withdraw.
- Dashboard: an "Earn" card on the vault page — APY, supplied amount, accrued interest, supply/withdraw.

## Acceptance criteria
- **PLP:** `/supply` mints PLP (real TX). **PLP is a user-held `Coin<PLP>`** returned to the user's address (the `PredictManager` holds dUSDC, not PLP) — the builder `transferObjects([plp], sender)`. `/withdraw` burns PLP for dUSDC, respecting `maxWithdrawable = min(vault.balance − total_max_payout, limiter.available)` (a capped withdraw shows the max available rather than failing; partial withdraws select/split PLP coins). The vault page forms work and the "What If" simulator produces sane numbers from live SVI/vault state with one worked golden example unit-tested.
- **Lending:** a user supplies dUSDC to `MarginPool<DUSDC>` (real TX, receives `SupplierCap`), the pool's APY/utilization render, and withdraw returns **at least principal**. Non-zero accrued interest is shown **only if** the pool has borrower activity (which we don't control) — a 0% APY is acceptable. Gated on confirming the Margin testnet pool **IDs and call signatures** first; if absent, Part B is explicitly deferred to Phase 8 with the probe output + dated reason recorded in `01 §4`.

## Test plan
- Unit: `previewSupply`/`previewWithdraw` math; limiter state parsing; "What If" MTM recomputation vs a worked example.
- Integration: supply → PLP balance up → withdraw (within available) → dUSDC back; margin supply → `SupplierCap` created → withdraw with interest.
- Edge: withdraw exceeding available/limiter → capped offer path.

## Risks
| Risk | Mitigation |
|---|---|
| No deployed testnet `MarginPool<DUSDC>` | Confirm first; if absent, deploy a pool or defer Part B to Phase 8 (log the decision) |
| Margin IDs on a different branch than Predict | Externalize both sets of IDs in env; pin per package |
| Withdrawal limiter confuses users | Plain-language UI + "max available" affordance |
| "What If" simulator inaccuracy | Label as an estimate; validate against one settled scenario |
