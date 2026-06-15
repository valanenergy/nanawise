# Phase 5 — Web Dashboard / Mini App (full)

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 5, §1 CC-7) before building. Key corrections: standalone-wallet `managerId` discovery + web create-manager; vol-surface multi-expiry data model; leaderboard PnL source; backend SSE/poll bridge (browsers can't subscribe to Sui events); agent-actions read API.

**Goal:** A complete, browsable Next.js surface judges can use independently of the bot: market, volatility surface, portfolio, vault, leaderboard, and the agent wallet page — plus standalone wallet connection (Slush/Suiet via dApp Kit) and Enoki zkLogin, all resolving to the same `PredictManager`.

**Depends on:** Phases 1–4 (auth, trading, keeper, agent). Extends the minimal Mini App screens from Phases 1–2.

## Scope

**In:** all dashboard pages, the shared layout/components, dApp Kit + Enoki connection, public profile page, Vercel deploy. The Mini App and dashboard are the **same** Next.js app; the Mini App is the chat-embedded view of the same pages.

**Out:** vault supply/withdraw on-chain flows (Phase 6 — the vault page here is read-only until then), margin UI (Phase 6/8), social pages beyond leaderboard read (Phase 7).

## Components

### Connection layer
- `@mysten/dapp-kit` for Slush/Suiet (standalone users) **and** Enoki Connect for Google zkLogin (same address as the bot — salt stability).
- A unified `useAccount()` that yields `{ suiAddress, managerId }` from whichever connection is active.

### Pages (`apps/web/app`)
- **`/` Market** — live BTC price (poll `/oracles/:id/state` every 10s), expiry countdown, strike table (UP/DOWN cost, implied prob), one-click mint (confirm modal → sponsor → sign), oracle lifecycle badge.
- **`/surface` Volatility surface** — SVI readout (`a,b,ρ,m,σ` from `/svi/latest`), heatmap (strike × expiry → IV) via Recharts, historical SVI param time series (`/svi`), butterfly/arb-free violation flag, 24h time-travel slider, live updates via `OracleSVIUpdated`.
- **`/portfolio` Portfolio** — open positions (mark vs cost, unrealized PnL), cumulative PnL chart (7d/30d), win-rate, strike heatmap, settled history with TX links. Sources: `/managers/:id/positions/summary`, `/managers/:id/pnl?range=ALL`, `/positions/minted|redeemed`, `/ranges/minted|redeemed`.
- **`/vault` Vault (read-only this phase)** — utilization, max-payout outstanding, withdrawal-available, PLP price, vault perf chart (`/vault/performance?range=ALL`), withdrawal-limiter (token-bucket) explained in plain language. Forms + "What If" simulator land in Phase 6.
- **`/leaderboard` Leaderboard** — global rankings (24h/7d/all) from `AgentAction`/settlement mirror + `/positions/redeemed`; row → read-only manager view.
- **`/agent` Agent wallet** — reads the on-chain `AgentPolicy` (id w/ explorer link, cap, remaining, expiry countdown, revoked), a budget meter, the `ActionExecuted` activity table (type, strike, amount, budget after, TX), strategy selector w/ one-paragraph edge/risk explanations, create/update + revoke buttons (sign via connected wallet).
- **`/u/:telegramId` Public profile** — share-card target: PnL, win rate, streak, QR to the app.

### Shared UI
- Layout, nav, theme; reusable `StrikeTable`, `PnlChart`, `BudgetMeter`, `TxLink`, `LifecycleBadge`, `ConnectButton`.
- Data layer: Tanstack Query for reads (with `waitForTransaction` + `invalidateQueries` after writes), the `predict-sdk` for server/chain access.

### Mini App parity
- The chat Mini App opens the same routes in a constrained viewport using the Telegram Web App SDK; signing uses the client-held key (Phase 1) rather than dApp Kit.

## Acceptance criteria
- Deployed on Vercel; all six pages render live testnet data.
- The vol surface updates live as `OracleSVIUpdated` events arrive; SVI params display correctly (signed ρ, m handled).
- Connecting the **same Google account** used in the bot shows the **same** positions/manager (salt stability verified end-to-end).
- A standalone Slush wallet user can connect, view, and mint (same `PredictManager` semantics).
- The agent page reflects on-chain policy state and the live activity feed, and the revoke button performs a real on-chain revoke.

## Test plan
- Component: `StrikeTable`, `PnlChart`, `BudgetMeter` snapshots; SVI heatmap given fixed params.
- Integration: connect (both modes) → read portfolio matches chain/server; mint from `/` → portfolio updates after `waitForTransaction`.
- Cross-surface: bot-onboarded account ↔ dashboard parity (same address/positions).

## Risks
| Risk | Mitigation |
|---|---|
| Bot vs dashboard address mismatch | Same Enoki app/`aud`; let Enoki own salt; explicit parity test |
| SVI heatmap correctness | Validate `shared/svi` against known values; cross-check with server-provided prices |
| predict-server schema drift breaks pages | SDK zod validation + graceful empty states |
| Telegram Mini App viewport quirks | Test in-Telegram early; responsive constrained layout |
| Live event volume | Throttle/coalesce updates; poll fallback if stream drops |
