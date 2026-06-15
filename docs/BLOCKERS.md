# BLOCKERS

Live blockers and required external actions. Updated as they clear. Nothing is committed.

## 🔴 External actions required (only you can do these)

| # | Blocker | Impact | Action |
|---|---|---|---|
| ~~B1~~ | ~~dUSDC faucet~~ — **CLEARED 2026-06-19**: dev addr `0xf9933de8…` funded with 1000 dUSDC; Phase 0 spike + agent lifecycle ran live | — | done |
| B2 | **Enoki sponsorship 403** — app forbids `createSponsoredTransaction` on testnet | Gasless onboarding/trading can't execute | In the Enoki Portal: enable **sponsored transactions** for testnet + allowlist move targets `<predict_pkg>::predict::{create_manager,mint,redeem,mint_range,redeem_range}`, `::predict_manager::deposit`, and `<agent_policy_pkg>::agent_policy::{create_policy,top_up,revoke}` |
| B3 | **Hot wallet unfunded** — `0xe348c963…f072` has 0 dUSDC / 0 SUI | Onboarding 100-dUSDC grant skipped | Fund it with dUSDC (≥ a few thousand) + SUI gas |
| B4 | **Telegram egress blocked** in build sandbox; no public Mini App URL | Bot can't reach `api.telegram.org`; Web App buttons need HTTPS | Run bot from an unrestricted host; expose `apps/web` via tunnel (cloudflared/ngrok) or Vercel; set `MINI_APP_URL` |
| B6 | **Keeper gas wallet unfunded** — `0xe6779087…df60` (Phase 3) | Keeper can watch but can't submit `redeem_permissionless` | Fund with SUI gas (~a few SUI; ~0.003/batch) |
| ~~B7~~ | ~~Agent wallet unfunded~~ — **CLEARED**: `0x817d91fa…` funded with 1 SUI; full agent lifecycle ran live (create_policy→trade→revoke→post-revoke abort) | — | done (top up SUI as needed for sustained runs) |

> **Move packages deployed to testnet** (2026-06-19): `AGENT_POLICY_PACKAGE_ID=0xff1c1ded545bfa37541e79cf07656769ad0158b134baf0672994da3c5c881dc1`, `ACTIVITY_LOG_PACKAGE_ID=0xb457f2a5841145d46136a3e951e891e9a4c723d41dea9eb3c2e7591d6353699f`. In `.env`.

## 🟠 Security hardening (from code review — status)

| # | Finding | Status |
|---|---|---|
| H1 | Sponsor proxy was an open relay (no auth, no `allowedAddresses`) | **Fixed**: sponsor now requires `sender` to be a known onboarded user + scopes `allowedAddresses:[sender]`. TODO (B5): verify Telegram `initData` for full auth |
| H2 | `onboard/complete` trusted the client-supplied `suiAddress` | **Fixed**: address derived server-side from the zkLogin JWT (Enoki `getZkLogin`); manager owner cross-checked on-chain when resolvable |
| H3 | Funding idempotency keyed inconsistently (lock on address, flag on telegramId) | **Fixed**: lock + flag both keyed on `telegramId` |
| M1 | `takeOAuthState` read-then-delete (replayable) | **Fixed**: atomic `GETDEL` |
| M2 | `readJson` unbounded body + raw error text leaked | **Fixed**: 256 KB cap + generic 500 message (detail logged) |
| M5 | Signed `I64` SVI (`rho`,`m`) silently became 0 on unexpected shapes | **Fixed**: explicit signed-i64 decoder (string / `{bits}` / `{value,is_negative}`) + warn-on-unparseable |
| M6 | `readManager` returned `owner:''` silently | **Fixed**: throws when object missing / not a move object |
| Enum | `shared ActionType` (REVOKE=3) mismatched Move `activity_log` (3=return_funds) | **Fixed**: aligned to `0 mint,1 redeem,2 mint_range,3 return_funds,4 leverage,5 copy` |
| B5 | Full Telegram `initData` HMAC verification on the sponsor/onboard endpoints | **TODO** (Phase 8 hardening) — currently gated by known-user + single-use state |

## 🟢 Phase 5–8 code review (2026-06-19) — fixes applied

Second code review (Phases 5–8) found 1 Critical, 4 High, 5 Medium, 6 Low. Resolutions:

| # | Finding | Status |
|---|---|---|
| C1 | WhatsApp Twilio signature claimed but absent | **Fixed**: HMAC-SHA1 `verifyTwilioSignature` (full URL + sorted params, timing-safe) gated on `TWILIO_AUTH_TOKEN`; rejects forgeries, warns once in sandbox. |
| H1 | Binary redemption idempotency — `@@unique` over nullable range cols doesn't dedupe in Postgres | **Fixed**: deterministic non-null `redemptionKey` `@unique` + `binaryKey()`; race-safe create-or-skip. |
| H2 | Tournament `payout` had no end-time gate (early settlement) | **Fixed**: `assert!(now_ms >= end_ms, ETooEarly)` + redeployed (`TOURNAMENT_PACKAGE_ID=0x049c5988…`). Move test `payout_before_end_aborts`; create+join re-verified live. |
| H3 | CORS `*` on state-changing endpoints | **Fixed**: scoped to `{miniAppUrl, localhost:3000, DASHBOARD_URL}`; webhook excluded. Verified live (evil origin → no ACAO). |
| H4 | Leaderboard ranked by gross payout, not PnL | **Fixed**: nets `payout − mint cost` per manager (bot + web). |
| L1 | No platform-fee cap | **Fixed**: `assert!(platform_fee_bps <= 1000, EBadFee)` in `create`. |
| M4 | copytrade dead `'confirm':'confirm'` ternary | **Fixed**: reads `copy_agent:{followerId}` Redis flag → honest confirm/agent mode. |
| M5 | `readVault` PLP supply silent-0 | **Fixed**: warns when `total_supply.value` shape missing. |
| M1/M2/M3/L4 | What-If single-leg proxy; agent strike tick-snap; signal parse; `/u/:id` stub | acknowledged, low-risk/UX — left as documented (see review). |

Web E2E (Playwright, persistent context): **8/8 routes render, 0 JS errors, session persists across reload.** Tournament Move now **7/7**. Whole gate: 47 TS tests, 21 Move tests, typecheck+lint+`next build` clean.

## 🟡 Deferred / known-limited

- **Phase 8 Part A — agent leverage demo (DeepBook Margin)** — deferred for the same reason as Phase 6 Part B: no confirmed testnet `MarginPool`/spot-pool + Pyth wiring in our validated sources. The activity-log already reserves `action_type=4 (leverage)`; once a margin pool is confirmed, the agent opens one ≤2x position via the config-gated margin builders. Cut to "future work" in the demo (logged), per the phase spec.
- **Phase 8 Part D — `@nanawise/keeper` standalone npm package** — the keeper runs as an app (`apps/keeper`); extracting it into a published `PredictKeeper({...})` library is additive and not yet done. `@nanawise/predict-sdk` + `@nanawise/shared` ARE publish-ready (built dual ESM/CJS+types, verified via `npm pack`). Actual `npm publish` needs the user's npm token.
- **WhatsApp / Twilio** — webhook + plain-text formatter built (`/webhooks/whatsapp`); running it needs Twilio sandbox creds (`TWILIO_AUTH_TOKEN`, a sandbox number) + a public URL.

- **Phase 5 dApp-Kit standalone wallet connect** (Slush/Suiet) — deferred. The zkLogin path (Google) covers onboarding + the demo; standalone-wallet connect + `managerId` discovery for external wallets is additive and can land before launch. `useAccount()` currently resolves from the zkLogin session + cached `managerId`.
- **Phase 5 live event push** — the dashboard polls (10s on Market) rather than streaming `OracleSVIUpdated` via a backend SSE bridge (browsers can't subscribe to Sui events). Polling is sufficient for the demo; SSE is a later optimization.

- **M4** — `normalizeOracleState` lifecycle is heuristic (no `trading_paused`, no on-chain `oracle::status`). Acceptable for reads; the real trade-gating `assertTradable` lands with Phase 2 trading. (See [08-build-progress](./08-build-progress.md).)
- **M3** — `previewMint` implied-prob is display-lossy (bigint floor before float). Display-only; do not use for sizing.
