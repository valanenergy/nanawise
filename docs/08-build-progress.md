# 08 — Build Progress & Live Test Log

Running status of the implementation. Nothing is committed (per the standing constraint).

## Implemented & verified

| Area | Package(s) | Verification |
|---|---|---|
| Monorepo scaffold | root, tooling | `tsc` clean, eslint clean |
| Constants/config/formatting/SVI | `@nanawise/shared` | 9 unit tests (incl. SVI `N(d2)`) |
| Protocol SDK (reads + devInspect + PTB builders) | `@nanawise/predict-sdk` | typecheck; **live**: getOracles → 4466 oracles |
| Phase 0 spike | `scripts/spike-mint.ts` | runs to fund gate on testnet |
| Agent escrow + activity log (Move) | `move/agent_policy`, `move/activity_log` | **12/12 Move tests** (full abort matrix) |
| Enoki + sponsor + session helpers | `@nanawise/sui-auth` | 4 unit tests |
| Postgres schema + client | `@nanawise/db` | `prisma migrate` applied to live Postgres |
| Bot + HTTP API (sponsor proxy, onboard) | `@nanawise/bot` | API boots; onboard endpoint e2e PASS |
| Phase 2 trading surface (redeem/range builders, previews, `assertTradable`, `mapExecutionError`) | `@nanawise/predict-sdk` | **live**: previewMint on active oracle; SVI model vs chain match (below) |
| Phase 2 bot commands (`/market /up /down /range /pnl /positions /redeem`) | `@nanawise/bot` | typecheck/lint; `/market` rendered live off the real oracle |
| Phase 1/2 Mini App (zkLogin login, OAuth callback, onboard, trade screen) | `@nanawise/web` (Next 15) | **`next build` passes**; all 5 routes serve 200; no private key in client bundle |
| Phase 3 keeper (watcher + redeemer + notifier) + bot settlement worker | `@nanawise/keeper`, `@nanawise/bot` | typecheck/lint; **live**: event-cursor query + `unredeemedBinaries` netting validated on real oracles |
| Phase 4 agent loop (strategies, agent PTB, keeper runner, `/policy /auto /revoke`) | `@nanawise/shared`, `@nanawise/predict-sdk`, `@nanawise/keeper`, `@nanawise/bot` | **Move deployed + full lifecycle LIVE (6/6) on testnet** (below) |
| Phase 5 dashboard (Market, Surface, Portfolio, Vault, Leaderboard, Agent, public profile) | `@nanawise/web`, `@nanawise/predict-sdk`, `@nanawise/bot` | **`next build` (12 routes) + live data layer validated** (below) |
| Phase 6 Part A — PLP vault supply/withdraw + What-If | `@nanawise/shared`, `@nanawise/predict-sdk`, `@nanawise/bot`, `@nanawise/web` | **LP round-trip LIVE on testnet** (below); 8 vault-math tests |
| Phase 6 Part B — Margin dUSDC lending | `@nanawise/predict-sdk` (`margin.ts`, config-gated) | **deferred to Phase 8** (no confirmed testnet `MarginPool<DUSDC>`; evidence below) |
| Phase 7 social (tournament Move, streaks, share cards, leaderboard, copy-trade, referrals, signal) | `move/tournament`, `@nanawise/bot`, `@nanawise/keeper`, `@nanawise/web` | **tournament escrow deployed + lifecycle LIVE (4/4)** (below) |
| Phase 8 polish/release (SDK publish, WhatsApp, load test, README/demo) | `@nanawise/predict-sdk`, `@nanawise/shared`, `@nanawise/bot` | SDK publish-ready (npm pack ✅); WhatsApp + load test LIVE (below) |

Whole-workspace gate: **47/47 unit tests, 20 Move tests (3 pkgs), typecheck clean (root + web), eslint clean, `next build` clean (16 routes).**

## Phase 8 — polish & release (2026-06-19)

- **Part D SDK release**: `@nanawise/predict-sdk` + `@nanawise/shared` are publish-ready — tsup dual ESM/CJS + `.d.ts`, `publishConfig` swaps `main`/`exports` to `dist` only at publish time (dev still consumes `src`), README with a 10-line mint example. `npm pack` verified: 6 files (README + dist), 29 kB. Actual `npm publish` needs the user's npm token. `@nanawise/keeper` standalone lib extraction deferred (documented in BLOCKERS).
- **Part B WhatsApp** (Twilio): `/webhooks/whatsapp` parses the form POST, replies TwiML wrapping a plain-text `respond()` (numbered menus + web links, no inline keyboards). Live-tested: `/market` pulled the live oracle ($62,394) into a plain-text reply. Signature validation gated on `TWILIO_AUTH_TOKEN`.
- **Part C polish/load**: `pnpm loadtest` — 20 concurrent onboard requests, **no 5xx**, all cleanly handled (SET-NX/error paths hold). Error UX (`mapExecutionError`, human messages) was completed in Phase 2.
- **Part A leverage demo**: deferred with margin (no confirmed testnet `MarginPool`); `action_type=4 (leverage)` reserved. See BLOCKERS.
- **Part E**: comprehensive root README — track coverage, live-on-testnet TX evidence, architecture, setup, and the 5-minute demo script.

## Phase 7 social — tournament escrow LIVE (2026-06-19)

`tournament` Move deployed: `TOURNAMENT_PACKAGE_ID=0x5f2a437f…`. Trustless prize-pool escrow (the DeFi-track "conditional payments" object — a PredictManager can't take third-party deposits). 6 unit tests (full abort matrix) + **live lifecycle 4/4**:
- create (`HcCvwCHz…`) → join, fee escrowed (`6XCQdmVZ…`) → payout: prize 0.97 to winner + 0.02 platform fee (`5yTuHrK2…`) → double-payout aborts (`EAlreadySettled`).

Other Phase 7 pieces (built; need the keeper+Redis running to exercise the loops):
- **Streaks**: keeper `notifier` already updates `Streak`; bot `/streak` with 🔥/💎/👑 badges.
- **PnL share cards** `/share`: `@napi-rs/canvas` PNG (PnL, win-rate, streak, BTC, attribution, QR → `/u/:id`).
- **Leaderboard**: bot `/leaderboard` + web page, global realized PnL from on-chain settlement events.
- **Copy-trading** (custody-aware): keeper `copytrade.ts` watches `PositionMinted` → `copy-trade` queue → bot `copy-worker` sends a one-tap **confirm** prompt (follower signs, no custody given up). `/copy /copyallow` consent both ways. Agent-copy mode reserved to the agent path.
- **Referrals**: `/start <refId>` captures `ref_pending` (rewards hook later).
- **Signal** `/signal`: keeper cron compares our N(d2) BTC-up prob vs Polymarket gamma-api, caches `signal:latest`; honest "different expiries" caveat.
- Mini App: `/miniapp/tournament` join screen. SDK: `tournament.ts` builders (create/join/payout).

## Phase 6 Part A — PLP vault LIVE (2026-06-19)

Full LP round-trip on testnet, preview matched the chain exactly:
- supply 50 dUSDC → **49.89 PLP** (predicted 49.89): `3U7XBstdBjfrsGugKWZTP7JQj3MZzN89KxQjHPhbiEzg`
- withdraw 24.94 PLP → dUSDC: `CEpeAZS5j7r4eCRe1fBA9Q3kw6hj7sqPhv4p6S7DdpWr`
- PLP confirmed as a USER-HELD coin (`getPlpBalance` on the address). Builders `transferObjects([plp/dusdc], sender)`.
- Vault math (`shared/vault.ts`): NAV/PLP-price/share preview, token-bucket limiter, and the "What If" simulator — 8 unit tests incl. a golden +5%-move example. Bot `/vault /supply /withdraw`; Mini App `/miniapp/vault`; dashboard vault page got supply/withdraw forms + a live What-If slider.

## Phase 6 Part B — Margin lending DEFERRED to Phase 8 (2026-06-19)

Evidence-based defer (spec sanctioned this path): the margin Move packages are on the deepbook repo `main` branch (not our validated `predict-testnet-4-16`); `@mysten/deepbook-v3` v1.5.1 ships a `MarginPoolContract` class but **no deployed testnet `MarginPool<DUSDC>` object ID** is published in our validated sources or the SDK constants (verified by web search + unpacking the SDK). Rather than fabricate IDs, `predict-sdk/margin.ts` carries the supply/withdraw builders **config-gated** on `MARGIN_PACKAGE_ID`+`MARGIN_POOL_ID` (absent now); a "💰 Earn — coming soon" card marks the spot in the vault UI. Activates with no code change once a pool is confirmed.

## Phase 5 dashboard — live data validated (2026-06-19)

Full browsable Next.js surface; all routes serve 200, data layer reads real testnet data:
- **Vault** (on-chain `readVault`): balance 1,017,612 dUSDC, max-payout 3,317, paused=false, limiter=disabled.
- **Portfolio** (`/managers/:id/pnl`): spike manager −0.13 dUSDC PnL.
- **Status** `/status` OK; **Leaderboard** aggregates 100 settled events across 29 traders.
- **Surface**: live SVI params + N(d2) probability smile.
- **Agent**: reads on-chain `AgentPolicy` + the `ActionExecuted` mirror via bot `GET /api/agent/:policyId/actions` (CORS-enabled).
- Nav across Market/Vol/Portfolio/Vault/Ranks/Agent; shared `LifecycleBadge`/`BudgetMeter`/`TxLink`. SDK reads added: `getStatus`, `getManagerPnl`, `getOracleSviHistory`, `readVault`.
- Note: dashboard pages are client components (data appears post-hydration); zkLogin session + cached `managerId` drive `useAccount()`. dApp-Kit standalone-wallet connect is deferred (zkLogin path covers the demo).

## Phase 0 spike CLOSED — real mint on testnet (2026-06-19)

dUSDC faucet landed (1000 dUSDC). `pnpm spike` ran the full path on a $1-grid strike:
- create_manager: `8HtwCNxaiR6odvU6tRJdob894hsqZBNhkr16Tfty3kfX`
- deposit + mint: `2qd1nrJUHjh6f6NmMZWV2v7yaMuSYkxaMU38z9SnD5wb`
- position qty 1000000 read back; manager balance correct. Confirms signatures, 6-dec units, Clock gating, table-quantity positions.
- Learning: strikes must be a multiple of `tick_size` ($1); the raw forward is not grid-aligned (`assert_valid_strike` aborts otherwise).

## Phase 4 Move deployed + agent lifecycle LIVE (2026-06-19)

Deployed to testnet: `AGENT_POLICY_PACKAGE_ID=0xff1c1ded…`, `ACTIVITY_LOG_PACKAGE_ID=0xb457f2a5…`.
Full on-chain lifecycle, **6/6 passing**:
1. create_policy — owner funds a 5 dUSDC escrow, agent authorized (`9vyyp4sn…`)
2. readAgentPolicy — budget/owner/agent/revoked correct
3. agent creates its own PredictManager
4. **agent trade PTB** `request_funds→deposit→mint→emit_action` — budget 5 → 4.478, **ActionExecuted emitted**, real mint (`AdSUUHuE…`)
5. revoke — returned 4.478 dUSDC to owner, revoked=true (`B44ELLJ8…`)
6. **post-revoke trade aborts on-chain (ERevoked)** — trustless guarantee verified

Agent strategies (vol-harvest/momentum/contrarian/delta-neutral) are pure functions on the verified SVI, unit-tested (10 cases). Keeper `AgentRunner` triggers on `OracleActivated`; `/policy /auto /revoke` wired in the bot.

### Keeper (`apps/keeper`, Phase 3)

### Keeper (`apps/keeper`, Phase 3)
- `watcher.ts` — `queryEvents` polling of the `oracle` module with a durable Redis cursor (resumes after restart; backfills on first start). Live-verified: cursor shape `{txDigest, eventSeq}`, parses `OracleSettled`/`OracleActivated`/`OraclePricesUpdated`.
- `redeemer.ts` — on `OracleSettled`, `unredeemedBinaries(oracle)` = minted − redeemed netted by (manager, strike, dir); batches ≤20 `redeem_permissionless` per PTB (keeper gas; payout lands in OWNER's manager). Skips the agent manager; ranges get a "tap to claim" DM (owner-gated). Idempotent via the `Redemption` ledger unique constraint. **Live-validated netting:** busy oracle `0xc33b9dac…` → 35 unredeemed (~1352 dUSDC); fully-settled oracles → 0. Unit-tested (`netting.test.ts`, 4 cases).
- `notifier.ts` — keeper is sole writer of `Redemption` + `Streak`; one streak event per (user, oracle) via Redis NX; enqueues `settlement-notifications` BullMQ jobs. Payout read from the redeem event (verified).
- Bot `settlement-worker.ts` — BullMQ worker sends the WON/LOST DM + range-claim prompt.
- Note: BullMQ gets connection *options* (not a shared ioredis instance) — its own dedicated connection, sidestepping the bullmq-bundled-ioredis version skew.

### Mini App (`apps/web`)
- Client-held ephemeral zkLogin key in `sessionStorage` (`lib/zklogin.ts`); backend never sees it.
- Sponsored execution flow (`lib/execute.ts`): build `onlyTransactionKind` → backend `/api/sponsor` → sign with ephemeral key → wrap zkLogin sig → `/api/sponsor/execute`.
- Routes: `/` (Google sign-in), `/auth/google/callback` (implicit `id_token` from URL fragment → Enoki address+ZKP), `/miniapp/onboard` (create_manager + register/fund), `/miniapp/trade` (preview → deposit-if-needed → mint/range/redeem).
- `.env.local` holds only `NEXT_PUBLIC_*` (public Enoki key, Google client id, chain IDs) — verified no `enoki_private` in the served bundle.
- Next config: `extensionAlias .js→.ts` so it can consume the raw-TS workspace packages; `transpilePackages`.

## SVI pricing validated against the live chain (2026-06-19)

After fixing the oracle-state parser (the server nests prices/SVI under `latest_price`/`latest_svi`
and carries signed SVI via `<field>_negative` siblings — my first parser silently returned spot=0/INACTIVE
for every oracle), `previewMint` succeeds live and our `shared/svi` `N(d2)` model matches the chain:

| Strike | Chain implied | Our N(d2) | Δ |
|---|---|---|---|
| $62,000 (ITM, fwd $62,482) | 100.00% | 100.00% | 0.00pp |
| $62,500 (ATM) | 41.31% | 41.28% | **0.03pp** |

The 0.03pp ATM agreement confirms the verified total-variance `N(d2)` form is correct. A regression
test (`server.test.ts`) now locks the real server shape. Off-grid/over-exposure strikes abort with the
protocol's own gates (expected, not a parser bug).

## Live e2e (2026-06-19) — 4/6 pass

- ✅ Redis SessionStore (oauth single-use + SET NX)
- ✅ Prisma User upsert/read/delete (local Postgres via brew)
- ✅ predict-server `getOracles` — 4466 oracles, BTC `0xdeaeda2055bceb949bc895c34ef389e66fe234ca911a53d89c5b1399b80987a5`
- ✅ HTTP `/api/onboard/complete` (state→user→session; funding + DM degrade gracefully)
- ❌ Telegram `getMe` — `api.telegram.org` blocked in the build sandbox (not a token/code issue; verify from an unrestricted host)
- ❌ Enoki `createSponsoredTransaction` — **403**; request reached Enoki but the app forbids it

## External actions still required

1. **dUSDC faucet** for the dev address `0xf9933de8…fcabe` (still 0) — unblocks `pnpm spike` (closes Phase 0) and hot-wallet funding.
2. **Enoki Portal config** (testnet): enable **sponsored transactions** and allowlist the predict move-call targets (`<predict_pkg>::predict::create_manager`, `::predict_manager::deposit`, `::predict::mint`). This clears the 403.
3. **Hot wallet** `0xe348c963…f072` needs dUSDC (for 100-dUSDC onboarding grants) + SUI gas.
4. **Telegram**: run the bot from a host that can reach `api.telegram.org`; needs an HTTPS Mini App URL (tunnel/Vercel) for Web App buttons.

## Local dev infra (this machine)

- Redis: `redis-server --daemonize yes` (brew). Postgres: brew `postgresql@16`, role `postgres`/`postgres`, db `nanawise`.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nanawise`.
