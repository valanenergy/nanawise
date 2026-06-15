# Phase 3 — Keeper & Settlement Loop

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 3, §1 CC-2) before building. Key corrections: keeper auto-redeems **binaries only** (ranges need an owner-signed claim); payout read from the redeem event; `Redemption` ledger for idempotency; `queryEvents` polling + cursor (not deprecated `subscribeEvent`).

**Goal:** When an oracle settles, the keeper auto-redeems every unredeemed position via `redeem_permissionless` (keeper pays gas) and the user gets a human settlement DM within ~60s — without the user doing anything.

**Depends on:** Phase 2 (`buildRedeemPermissionless`, server reads), Phase 1 (user records).

## Scope

**In:** `apps/keeper` watcher + redeemer + notifier; Bull queue; settlement DM worker in the bot; Postgres base records; keeper gas wallet.

**Out:** agent loop (Phase 4), streaks/cards (Phase 7) — though the notifier emits the events streaks will later consume.

## Why this is valid (validated)
`redeem_permissionless<Quote>` requires `oracle.is_settled()` and has **no sender check** — it deposits the payout into the **owner's** manager regardless of caller (`PositionRedeemed` carries both `owner` and `executor`). So the keeper, using its own keypair + SUI, can settle everyone's positions. Confirmed against source.

## Components

### `watcher.ts`
- Subscribe to the Sui event stream filtered by the Predict package; handle `oracle::OracleSettled` (extract `oracle_id`, `settlement_price`) and `oracle::OracleActivated` (cycle boundary, also used by Phase 4).
- Reconnect/backoff; checkpoint the last processed cursor so a restart doesn't miss settlements.

### `redeemer.ts`
- On `OracleSettled`: `getPositionsMinted({ oracleId, redeemed: false })` → binary positions to settle. (Ranges handled separately, below.)
- **Binaries only:** group by manager; build PTBs of **≤20** `redeem_permissionless` calls each (gas cap); submit with the keeper key; `waitForTransaction`. The payout for each lands in the **owner's** manager (verified — no sender check).
- **Ranges have NO permissionless path** (`redeem_range` is owner-gated, verified `03 §10`). The keeper cannot auto-settle them. For each settled `getRangesMinted({redeemed:false})`, the keeper instead enqueues a "range settled — tap to claim" notification; the user signs `redeem_range` in the Mini App.
- **Skip the agent manager** (known from config / Phase 4): it gets no DM/streak; its settled positions are swept via Phase 4's `return_funds` flow, not this path.
- **Idempotency:** the `Redemption` ledger (`05`) with its unique constraint is the race guard — insert-on-claim; re-query `redeemed=false` before building; a restart never double-submits.

### `notifier.ts`
- **Payout comes from the redeem event** (verified): `PositionRedeemed.payout` / `RangeRedeemed.payout` (and `bid_price`). No off-chain payout computation. Result = WON if `payout > 0` else LOST.
- Resolve `owner → telegram_id` (Postgres); push a `settlement-notifications` Bull job `{ telegram_id, result, payout, strike, direction, oracleId }`.
- **Single settlement contract:** the keeper (sole writer) writes the `Redemption` row **and** updates `Streak` directly (one streak event per settled oracle, net result by aggregate payout vs cost; dedupe `(userId, oracleId)`). Phase 7's leaderboard reads these rows — no separate "settlement mirror."

### Bot DM worker (`apps/bot`)
- Consume `settlement-notifications`; format the DM; send via Telegram (and WhatsApp later). Include `[Trade again] [Share result]`.

### Data
- Postgres: a `redemptions` ledger (manager, key, payout, txHash, settledPrice, createdAt) for idempotency + history; index by manager.

## Settlement DM format
```
✅ BTC settled at $68,102
Your position: BTC UP $67,500 → WON 🎉
Payout: 28.50 dUSDC → added to your balance
[Trade again]  [Share result]
```
(LOST variant: "BTC closed below your strike — no payout this time.")

## Operational notes
- Keeper pays its own SUI gas (~0.003 SUI per batch; ~$0.01). Monitor keeper SUI; alert when low.
- Settlement is **operator-driven** (post-expiry `update_prices`); the keeper cannot force it. If no settlement occurs during a demo, show a previously captured DM (documented in the demo script).
- Cap concurrency so we don't exceed RPC limits during a settlement burst.

## Acceptance criteria
- A position minted in Phase 2 is automatically redeemed after its oracle settles, with the payout appearing in the owner's manager (verify via `getManagerSummary` + chain read), and a DM arriving **within 60s** of `OracleSettled`.
- Restarting the keeper mid-settlement does not double-redeem (idempotency holds) and does not miss positions (cursor + re-query).
- A settled oracle with >20 positions is processed across multiple PTBs successfully.

## Test plan
- Unit: batching (splits at 20), idempotency key logic, owner→telegram resolution, DM formatting (WON/LOST/range).
- Integration: mint near a soon-to-settle oracle → observe `OracleSettled` → assert redeem TX + manager payout + DM job enqueued + DM sent.
- Failure injection: kill keeper after a partial batch → restart → assert no double redeem, remaining positions completed.

## Risks
| Risk | Mitigation |
|---|---|
| Missed settlement on downtime | Cursor checkpoint + on-start backfill via `getPositionsMinted(redeemed=false)` for recently settled oracles |
| Oracle never settles during demo | Captured DM fallback; pre-position before demo |
| Keeper SUI exhausted | Monitor + alert + pre-fund |
| predict-server lag on `redeemed` flag | Re-query at build time; chain-read confirm before marking done |
| PTB exceeds gas with big batches | Hard cap 20/PTB; sequential PTBs |
