# Phase 2 — Core Trading (mint / redeem / range, market, PnL)

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 2, §1 CC-1/CC-2) before building. Key corrections: deposit-into-manager funding; `previewMintRange`/`previewRedeemRange`; `mapExecutionError` for post-trade aborts; `buildRedeemPermissionless` is binary-only.

**Goal:** A funded user can trade the full binary + range lifecycle from chat (signing in the Mini App): view the market, place UP/DOWN/range positions, see PnL and positions, and early-exit — all with real TXs and correct, human error handling.

**Depends on:** Phase 1 (wallet + signing), Phase 0 (SDK).

## Scope

**In:** complete `predict-sdk` trading builders + server reads; bot commands `/market /up /down /range /pnl /positions /redeem`; Mini App trade-confirm-and-sign screen; full error UX for every protocol gate in `03 §6`.

**Out:** keeper auto-redeem (Phase 3 — here `/redeem` is the manual early-exit only), agent, vault/supply, social.

## Components

### `packages/predict-sdk` (complete trading surface)
- Builders: `buildRedeem`, `buildMintRange`, `buildRedeemRange`, `buildRedeemPermissionless` (defined here for the keeper, used in Phase 3), plus `rangeKey(...)`.
- Server reads: `getOracleState`, `getAskBounds`, `getManagerSummary`, `getManagerPositions`, `getManagerPnl`, `getOraclePriceLatest`, `getOracleSviLatest`, `getPositionsMinted`, `getPositionsRedeemed`, `getRangesMinted`, `getRangesRedeemed`, `getTrades`.
- `previewMint(params)` / `previewRedeem` wrapping `get_trade_amounts` (preview, no state change) → `{ cost, payout, impliedProb }`.
- `assertTradable(oracleState)` helper: throws typed errors for `STALE` (>30s), `NOT_ACTIVE`, `PENDING_SETTLEMENT`, `SETTLED`, `PAUSED`.

### Bot commands (`apps/bot/src/commands`)
All state-changing commands follow: validate session → preview → open Mini App to confirm+sign → on execute, post a result card with TX link + inline keyboard.

- `/market` — read-only: oracle state + ask-bounds → strike table with UP/DOWN cost + implied prob + time-to-expiry + ATM marker. `[🔄 Refresh] [💡 Implied prob?]`.
- `/up <strike> <amount>` and `/down <strike> <amount>` — parse + validate → `previewMint` → Mini App confirm (`buildMint`) → result card `[📊 PnL] [🔄 Flip] [📤 Share]`.
- `/range <low> <high> <amount>` — `buildMintRange` with `rangeKey`.
- `/pnl` — `getManagerPositions` + `getManagerPnl` → open (mark vs cost) + last settled + today PnL + win rate. `[📤 Share] [Full history →]`.
- `/positions` — full detail incl. `MarketKey` components + countdowns (Arjun persona).
- `/redeem <strike> <direction>` — **pre-settlement early exit only**: confirm `oracle` not settled → `previewRedeem` → Mini App confirm (`buildRedeem`). If settled → "settles automatically; keeper redeems within ~60s" (Phase 3).

### Mini App trade screen (`apps/web/app/miniapp/trade`)
- Receives `{ action, oracleId, strike, amount, ... }` from the bot deep-link.
- Shows preview (cost, max payout, implied prob, expiry), builds the PTB via `predict-sdk`, requests sponsorship, **signs with the client-held key**, executes, returns a result + TX hash to the bot.
- Inline amount picker (so Riya never types raw units); plain-language summary ("You pay 21.50, win 50 if BTC ≥ $67,500 at 14:32").

### Formatting
- All amounts via `shared/formatting` (human units in UI, `1e6` base in calls). Strikes formatted; implied prob from ask price.

## Error UX (maps to `03 §6` — every case must be human)
| Condition | Message |
|---|---|
| Oracle stale (>30s) | "Market is refreshing — try again in a few seconds." (never auto-retry the mint) |
| Oracle not active | "This strike is no longer open. Use /market for current strikes." |
| Pending settlement | "This market is settling now — trading is paused for a moment." |
| Insufficient balance | "You have X dUSDC; this needs Y." |
| Exposure cap hit | "The vault can't take this position right now — try a smaller amount or another strike." |
| Ask out of bounds | "That price moved out of range — refresh and retry." |
| Trading paused | "Trading is paused on the protocol right now." |
| Session expired | "Your session expired — tap to re-link Google." |

## Acceptance criteria
- Full lifecycle on testnet: `/market` shows live strikes; `/up` and `/down` mint (real TXs); `/range` mints a range; `/pnl` and `/positions` show the open positions with correct marks; `/redeem` early-exits a live position (real TX).
- Every error in the table above is reproducible and shows the human message (not a stack trace) — verified by forcing at least: stale oracle, insufficient balance, and settled-position redeem.
- Amounts shown to the user are always human units; no raw `1e6`/`1e9` leaks into UI.

## Test plan
- Unit: `previewMint`/`previewRedeem` math; `assertTradable` for each lifecycle state; amount parsing/formatting edge cases (decimals, zero, > balance).
- Integration: mint → read position → early redeem → read position cleared, against testnet.
- UX: snapshot the result cards and `/market` table formatting.

## Risks
| Risk | Mitigation |
|---|---|
| Opening the Mini App per trade adds friction | Keep the screen instant (pre-pass preview data via deep-link); persist the client key so re-open is fast; document optional "fast mode" for later |
| Strike not on the grid | Validate against ask-bounds/grid before preview; suggest nearest valid strike |
| Mark/PnL mismatch vs server | Treat server values as display truth; reconcile with chain read on the detail view |
| Race: oracle flips ACTIVE→PENDING between preview and sign | `assertTradable` re-checked at sign time; PTB reverts safely; show "market just settled" |
