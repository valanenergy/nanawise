# Phase 7 — Social & Gamification

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 7, §1 CC-3) before building. Key corrections: tournament escrow is a custom `tournament` Move object (a `PredictManager` can't take third-party deposits); agent-copy is a new agent code path; streak semantics + copy-trade payload pinned down.

**Goal:** Make the product viral and sticky: streaks, shareable PnL cards, group leaderboards and tournaments, copy-trading, referrals, and the cross-venue signal.

**Depends on:** Phase 3 (settlement events feed streaks/leaderboard), Phase 2 (trading), Phase 5 (public profile page).

## Scope

**In:** streaks, `/share` PnL cards, `/leaderboard` (group + global), group chat mode, tournaments (escrow), copy-trading (with explicit custody handling), referrals, `/signal` (Polymarket).

**Out:** anything requiring protocol changes. Copy-trading custody is handled explicitly (below).

## Components

### Streaks
- Keeper `notifier.ts` updates `Streak` on each settlement (win → `current++`, update `longest`, `lastWinDate`; loss → reset). Badges: 🔥3 / 💎10 / 👑25.
- Bot `/streak`.

### PnL share cards (`/share`)
- `@napi-rs/canvas` renders a PNG: handle, total PnL (green/red), win rate, streak badge, current BTC price, "traded on DeepBook Predict" attribution, QR (`qrcode`) → `/u/:telegramId`. Returned via `ctx.replyWithPhoto(buffer)`.

### Leaderboards (`/leaderboard`)
- Group context → top traders in this group by today's PnL (Redis sorted set, reset midnight UTC, durable in Postgres). Private chat → global, aggregated realized PnL from the keeper's `Redemption` rows (`05`) + `/positions/redeemed` + `/ranges/redeemed`. (There is no separate "settlement mirror"; `AgentAction` is agent activity, not user PnL.)

### Group mode & tournaments
- Adding the bot to a group creates a `Group` row; group leaderboard maintained.
- **Escrow is a custom `tournament` Move object, NOT a `PredictManager`** — a manager's `deposit` is owner-gated, so it cannot accept third-party entry fees (same wall as the agent design). The `tournament` object mirrors `agent_policy`: holds `Balance<DUSDC>`, `join()` joins each entrant's `Coin<DUSDC>`, and an owner/bot-only `payout()` releases the pool conditionally → the DeFi-track "conditional payments" bullet, trustless. (`05`: `Tournament.escrowObjectId`.)
- `/tournament start <hours> <entryFee>` creates the escrow object; `/tournament join` calls `join()` with the fee; `/tournament status` reads standings.
- Ranking from `/positions/(minted|redeemed)` filtered to `[startTime, endTime]` per participant; rank **only after** all in-window oracles reach SETTLED (grace period — sub-hour expiries may settle after `endTime`); define a tie-break (higher win-rate, then earliest). `winnerUserId` + `prizePool` (= fees − platform fee) written atomically with the `payout()` TX (keeper sole writer).

### Copy-trading (custody-aware)
- `PositionMinted` watcher → for each consenting follower, push a `copy-trade` job (payload per `05`: `{ follower_id, targetId, oracle, expiry, strike, isUp, sizing, mode }` — `expiry` is required to build the `MarketKey`).
- **Custody reality (validated):** replaying a mint into a follower's manager requires the follower's signing authority, which (with client-held keys) the backend does not have. Two supported modes:
  1. **Confirm-to-copy (default, `mode='confirm'`):** the follower gets a one-tap Mini App prompt to sign the mirrored trade. No custody given up.
  2. **Agent-copy (opt-in, `mode='agent'`):** a **new agent code path** — the worker injects a one-off copy mint into the follower's agent PTB (`request_funds → deposit → mint → emit_action`), sized by `sizing`, gated by budget/expiry/revoked, logged with `action_type=copy`. The mirrored position lands in the **agent's own manager** (not the follower's user manager). This is NOT free reuse of `04`'s strategy loop — it is an externally-triggered trade and must be specified as such.
- Consent: the **target** opts in to being copied (`consent` flag / `/copy-allow`); the **follower** opts into a mode. At execution, re-check oracle freshness (<30s) + ask-bounds + exposure (same gates as Phase 2); drop or re-prompt if the oracle has left `ACTIVE`.

### Referrals
- `/start?ref=<userId>` deep link → store `refByUserId`; simple referral counts for a future rewards hook (no token economics in scope).

### Cross-venue signal (`/signal`)
- Keeper cron (every 5 min): query Polymarket `gamma-api` for a comparable BTC market, extract implied prob, compare to ours (SVI/server), write `signal:latest` to Redis. `/signal` reads it. UI clearly states the comparison is imperfect (different expiry structures) — informational, not guaranteed arbitrage.

## Acceptance criteria
- A group tournament runs end-to-end: start (escrow funded via PTB), members trade, winner paid from escrow at the end (real TXs), standings via `/tournament status`.
- `/share` produces a clean PNG that looks good reposted; `/streak` and `/leaderboard` reflect real settlement outcomes.
- Copy-trading works in **confirm-to-copy** mode end-to-end (a follower mirrors a trader after a one-tap sign), and the **agent-copy** path is demonstrated for an opted-in user; consent is enforced both ways.
- `/signal` shows our vs Polymarket implied prob with the spread and the honest caveat.

## Test plan
- Unit: streak transitions; card rendering (snapshot); tournament ranking + payout math (fee, ties); copy sizing (fraction vs fixed); signal spread calc.
- Integration: tournament lifecycle on testnet (escrow → trades → payout); copy job from a `PositionMinted` event → follower prompt/sign; signal cron writes cache.
- Consent/negative: copy without target consent blocked; copy after oracle left ACTIVE dropped.

## Risks
| Risk | Mitigation |
|---|---|
| Copy-trade custody (can't sign for client-held-key users) | Confirm-to-copy default + agent-copy opt-in; documented, no silent custody |
| Tournament escrow correctness | Bot-controlled manager; deterministic ranking from settled events; unit-tested payout |
| Polymarket market mismatch | Show caveat; pick closest strike/expiry; mark low-confidence |
| Card generation native deps on host | `@napi-rs/canvas` prebuilt binaries; test on Railway image |
| Leaderboard gaming | Base global ranking on on-chain settlement, not self-reported |
