# 07 — Plan Review: Findings & Resolutions

Nine plan-reviewer agents independently audited Phases 0–8 against the validated protocol reference (`03`), the architecture (`02`), the agent design (`04`), the data model (`05`), and security (`06`), checking each phase for gaps across **backend, frontend, Move, data, tests, cross-phase interfaces, and protocol validity**.

**Result:** all nine phases scored **BUILDABLE WITH FIXES**; none was NOT BUILDABLE. The architecture is sound. The gaps are execution-level and handoff-level. This document records every finding and its resolution, and lists the concrete edits applied to the foundation docs.

> Status legend: ✅ resolved inline (doc edited) · 🔎 pending source verification (see §6) · 📋 resolution specified here, fold into the phase during build.

---

## 1. Cross-cutting blockers (affect multiple phases)

### CC-1 — Manager funding / missing `buildDeposit` (BLOCKER) ✅🔎
`predict::mint` spends the **manager's internal `BalanceManager` balance** (it calls `manager.withdraw<Quote>(cost)` internally and takes **no `Coin` argument**). The plan funded the user's *address* (Phase 1) and never deposited into the manager, and the SDK had no `buildDeposit`. Without a deposit, `/up`/`/down` revert on a "funded" account.

**Resolution:**
- Add `buildDeposit(p:{ managerId, coinType, amount })` and `getManagerBalance`/on-chain `balance<T>` read to the SDK (`03 §8`).
- Onboarding (Phase 1) funds by depositing 100 dUSDC **into the user's manager** (hot-wallet → user address → `deposit`, or hot-wallet sends a `Coin` the create-PTB deposits). Define "spendable balance" = manager balance everywhere (the "insufficient balance" message uses the manager balance).
- The agent PTB (`04`) already does `request_funds → deposit(agent_manager) → mint` — this is the correct shape; confirm `mint` pulls cost from the agent manager's internal balance (🔎 §6.1).

### CC-2 — No permissionless range redeem (BLOCKER) ✅🔎
`redeem_permissionless` exists only for **binary** positions (`MarketKey`). `redeem_range` is owner-gated. The keeper therefore **cannot auto-settle range positions** (Phase 3 assumed it could; Phase 2's builder contract implied it).

**Resolution (pending §6.2 confirmation):**
- Scope keeper auto-redeem to **binaries only**. For settled **ranges**, the keeper sends the owner a "your range settled — tap to claim" Mini App prompt that signs `redeem_range` (owner). Update Phase 2 (`buildRedeemPermissionless` = binary only), Phase 3 (binary auto-redeem + range user-claim path), and acceptance criteria.

### CC-3 — Tournament escrow can't be a `PredictManager` (CRITICAL) ✅
`predict_manager::deposit` asserts `sender == owner`, so joiners can't deposit entry fees into a bot-owned manager — the same custody wall that reshaped the agent design.

**Resolution:** replace the manager-escrow with a small **`tournament` Move escrow object** (`Balance<DUSDC>`, `join()` joins balances, owner/bot-only conditional `payout()`), mirroring `agent_policy`. This also delivers the DeFi-track "conditional payments" bullet trustlessly. Update Phase 7 + `05` (`Tournament.escrowObjectId`).

### CC-4 — zkLogin signing handoff to Phase 2 incomplete (CRITICAL) ✅
Signing a trade in Phase 2 needs more than the ephemeral key + proof: it needs `maxEpoch` and an `addressSeed` derived from `genAddressSeed(salt, "sub", jwt.sub, jwt.aud)`, assembled via `getZkLoginSignature`. Phase 1 only stored "the proof."

**Resolution:** Phase 1 persists (client-side) the full set `{ ephemeralKeyPair, zkProof, maxEpoch, jwt(sub+aud), salt }` and `sui-auth` exposes `buildAddressSeed(salt, jwt)` + `assembleZkLoginSignature(...)`. Declared as the produced interface for Phase 2.

### CC-5 — `network: "testnet"` must be explicit on every Enoki call (CRITICAL) ✅
Enoki endpoints default to **mainnet**; omitting `network` silently yields wrong addresses/proofs and sponsor failures.

**Resolution:** every `sui-auth` Enoki wrapper takes a required, config-derived `network` (`SUI_NETWORK`); a unit test asserts no Enoki call is constructed without it. Noted in `06` + Phase 1.

### CC-6 — Sponsorship allowlist must cover every sponsored Move call (HIGH) ✅
`allowedMoveCallTargets`/`allowedAddresses` were specified abstractly. Each phase that sponsors a new call must add its targets or Enoki rejects the tx.

**Resolution:** `06` now enumerates the allowlist per phase: Phase 1 (`create_manager`, deposit/funding transfer), Phase 2 (`predict::mint/redeem/mint_range/redeem_range`, `deposit`), Phase 4 (`agent_policy::*`, `activity_log::*`), Phase 6 (`predict::supply/withdraw`, margin supply/withdraw if sponsored), Phase 7 (`tournament::*`).

### CC-7 — Browser can't subscribe to the Sui event stream (HIGH) ✅
The dashboard's "live vol surface / live agent feed" assumed direct event subscription; browsers can't do that.

**Resolution:** backend exposes an SSE/WebSocket bridge for `OracleSVIUpdated` and `ActionExecuted`; the client uses it with a polling fallback (`getOracleSviLatest`, the agent-actions API). Noted in `02`/`05`, Phases 5 & 4.

---

## 2. Per-phase findings & resolutions

### Phase 0 — Foundation
| Sev | Finding | Resolution |
|---|---|---|
| BLOCKER | Spike needs `deposit` but no `buildDeposit` in SDK | CC-1 ✅ |
| BLOCKER | Funding model (address vs manager) mismatch with Phase 1 | CC-1 ✅ |
| SHOULD | Spike doesn't assert previewed cost == charged cost (units) | 📋 add assertion: manager-balance delta == previewed `mint_cost` |
| SHOULD | Spike doesn't read/log revert-path inputs (ask-bounds, staleness, exposure) | 📋 spike logs `ask_bounds`, `timestamp`, status; optionally forces one stale/out-of-bounds revert to capture codes |
| SHOULD | `OracleState` shape not pinned (needs `status,timestamp,expiry,spot,settlementPrice?`) | ✅ pinned in `03 §8` types + Phase 0 `types.ts` |
| NICE | `direction:u8` round-trip not asserted; redeem not exercised; checklist artifact undefined | 📋 read position back by same `MarketKey`; add a `## Checklist` section for TX hashes |

### Phase 1 — Wallet & Auth
| Sev | Finding | Resolution |
|---|---|---|
| CRITICAL | Phase 2 signing artifacts not persisted | CC-4 ✅ |
| CRITICAL | `network` defaults to mainnet | CC-5 ✅ |
| HIGH | Completion callback unauthenticated (state replay) | ✅ require HMAC-verified Telegram `initData`, cross-check `user.id == oauth:{state}.telegram_id`, consume state atomically (`GETDEL`) |
| HIGH | `oauth:{state}` field-write ordering impossible (bot writes client-generated fields) | ✅ bot writes `{telegram_id}` at `/start`; Mini App fills `{ephemeralPublicKey,nonce,maxEpoch,randomness}` on the verified completion call |
| HIGH | Nonce/epoch source ambiguous | ✅ use Enoki `POST /v1/zklogin/nonce` (atomic nonce/randomness/maxEpoch) OR mandate epoch from `getLatestSuiSystemState()` |
| HIGH | Funding idempotency has no schema | ✅ add `funded`/`fundedTxDigest` to `User` (`05`) + Redis NX funding lock |
| MED | Manager ID must be read from effects (anchored regex) | 📋 onboard step: `showEffects` + `waitForTransaction` + anchored extraction (reuse Phase 0) |
| MED | Sponsor private key must be backend-proxied (not in `apps/web`) | ✅ Mini App calls backend `/api/sponsor`; build-time check that `ENOKI_PRIVATE_KEY` is absent from client bundle |
| MED/LOW | "no key server-side" test unfalsifiable; re-auth must reuse address/manager; `epochExpiryMs` source; pre-sign epoch guard | 📋 add log/Redis grep test; re-auth skips create_manager/funding if `managerId` set; `epochExpiryMs` from Enoki `estimatedExpiration`; wire `06` epoch guard into the sign step |

### Phase 2 — Core Trading
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Manager-funding gap (mint spends manager balance) | CC-1 ✅ |
| HIGH | Keeper range auto-redeem impossible | CC-2 ✅🔎 |
| MED | No `previewMintRange`/`previewRedeemRange` (wraps `get_range_trade_amounts`) | ✅ added to `03 §8` + `/range` flow |
| MED | Post-trade aborts (exposure, ask-out-of-bounds) need a Move-abort→message mapper | ✅ add `mapExecutionError(abortCode)` as a Phase 2 component (complements `assertTradable`) |
| MED | Sponsor allowlist must include trade targets | CC-6 ✅ |
| LOW | `/redeem` three-way gate (live/pending/settled); deep-link needs `expiry`; Mini App→bot result transport | 📋 use `oracle::status` three-way; include `expiry` in payload; reuse Phase 1 completion-callback transport |
| LOW | Tests miss exposure/ask-bounds/pending/paused + range early-exit | 📋 add negative-path + range integration coverage |

### Phase 3 — Keeper & Settlement
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Range auto-redeem via keeper impossible | CC-2 ✅🔎 |
| HIGH | DM payout amount has no source | 🔎 §6.3 — parse `PositionRedeemed` if it carries payout, else compute (WON ⇒ quantity face value, LOST ⇒ 0) from settlement vs strike; persist in ledger |
| MED | `Redemption` ledger missing from `05`, no unique constraint | ✅ add `Redemption` model with `@@unique([managerId, oracleId, strike, direction, isRange])` + serialized key |
| MED | Event subscription mechanism undefined (`subscribeEvent` deprecated) | ✅ specify `queryEvents` polling (2–3s) with persisted cursor in Postgres + exponential backoff; backfill = scan `getPositionsMinted({redeemed:false})` for SETTLED oracles |
| MED | Streak handoff described three ways | ✅ one contract: keeper (sole writer) writes `Redemption` + updates `Streak` directly; documented fields |
| MED | Agent manager not carved out (would get a DM) | 📋 redeemer skips DM/streak for the agent `managerId`; agent redeem + `return_funds` owned by Phase 4 sweep |
| LOW | `RedeemPermissionlessParams` untyped; partial-batch gas test; concurrency caps + keeper submission lock | 📋 type the param (owner's `managerId`); add gas-failure test; serialize keeper PTBs (reuse signing-lock) |

### Phase 4 — Agent Wallet
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | PTB pseudocode implies `mint` consumes a coin (it doesn't) | ✅ `04` PTB clarified: `request_funds(amount) → deposit(agent_manager, coin) → mint()` (mint pulls cost from internal balance) |
| HIGH | Mint price is post-trade → exact `mint_cost` unknown pre-call | ✅ request `ceil(previewCost × (1+ε))`, ε≈1–2%; dust stays in agent manager, swept via `return_funds`; under-funded → safe PTB revert |
| HIGH | `amount_spent`/`budget_remaining` logging vs true cost | ✅ log `amount_spent` = amount released from escrow; capture true cost from `PositionMinted.cost` for PnL; reconcile in mirror |
| HIGH | `return_funds`/revoke custody: revoke doesn't reclaim unswept manager balance; `budget_cap` vs escrow invariant breaks | ✅ dashboard meter reads live `escrow` balance (not `cap − spent`); spec the redeem→withdraw→return sequence; force a sweep at/after revoke to reclaim manager-held payouts |
| MED | No `PolicyCreated`/`PolicyRevoked` events (UI/keeper must poll) | ✅ add both events for low-latency revoke detection |
| MED | `emit_action`/`return_funds` permissionless → forged events / mirror pollution | ✅ mirror only trusts `ActionExecuted` whose tx sender == policy.agent, cross-checked on-chain |
| MED | Strategies under-specified for deterministic tests | ✅ each strategy defined as a pure function (inputs→strike,isUp,quantity); realized-prob estimator = stdev of last N hourly log-returns → lognormal binary prob |
| MED | SVI integer→float scaling unspecified | 🔎 §6.6 — pin scaling + `T` in years + one golden vector; centralize in `shared/svi` |
| MED/LOW | Move test matrix missing under-funded abort + happy-path PTB proof; oracle pre-flight gate | 📋 add tests (incl. agent-as-owner passes predict's owner check, post-revoke abort); bind agent loop to `assertTradable` |

### Phase 5 — Dashboard / Mini App
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Standalone (Slush) wallet has no `managerId`/`User` row | ✅ discover via `PredictManagerCreated` events filtered by owner; else web `buildCreateManager` onboarding; upsert a web-first `User` |
| HIGH | Vol-surface "strike × expiry" has no multi-expiry source (one oracle = one expiry) | ✅ enumerate active oracles via `getOracles()`; if only one, render strike × time-to-expiry smile (relabel axis) |
| HIGH | Leaderboard references a nonexistent "settlement mirror" | ✅ aggregate realized PnL from `/positions/redeemed` + `/ranges/redeemed` (or `getManagerPnl`); Phase 5 ships the read, Phase 7 adds Redis/group layer |
| MED | `/` mint must reuse Phase 2 `assertTradable` + error table | 📋 reference Phase 2 error UX on the web mint surface |
| MED | dApp Kit sponsored-vs-self-gas signing path undefined | ✅ standalone users sign via `useSignTransaction`; sponsored via Enoki with wallet user-signature (address allowlisted) or self-gas — documented |
| MED | Live-update transport for surface/agent feed | CC-7 ✅ |
| MED | No read API for the `AgentAction` Postgres mirror | ✅ add backend `/api/agent/:policyId/actions` + typed read |
| LOW | path↔method reconciliation; salt-parity test; `/u/:telegramId` resolver | 📋 all reads via SDK methods; add explicit bot↔dashboard address-parity test; specify `telegramId→User→managerId→getManagerPnl` + Streak, gated by consent |

### Phase 6 — Vault / LP + Margin Lending
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | "What If" simulator math undefined | ✅ spec: `vaultValue = vault.balance − total_mtm`; `plpPrice = vaultValue / plpSupply`; hypothetical move → shift forward, hold SVI → recompute each open strike `binaryUpPrice` → new MTM; name read sources; one worked golden example |
| HIGH | Margin builders/signatures unverified, on a different branch | ✅ gate Part B on confirming **both** IDs **and** signatures; add a "Validated Margin facts" block before building, else defer to Phase 8 |
| HIGH | Over-claim: non-zero APY/interest (zero borrowers ⇒ 0%) | ✅ soften acceptance: supply succeeds + `SupplierCap` received + pool state renders + withdraw returns ≥ principal; interest only if borrower activity exists |
| MED | Withdrawal-limiter read/math undefined | 🔎 §6.5 — read `RateLimiter` fields; `maxWithdrawable = min(vault.balance − total_max_payout, bucketFill)`; refill projection for UI |
| MED | Phase 5↔6 vault component reuse not pinned | ✅ Phase 6 reuses Phase 5 vault hooks/components (named), adds write affordances only |
| MED | No per-user PLP balance read path | ✅ `getPlpBalance(address)` via `getBalance({owner, coinType: PLP})`; share = `userPLP / total_supply` |
| LOW | **"returns Coin<PLP> into the manager" is WRONG** — PLP is a user-held coin | ✅ fix wording: supply returns `Coin<PLP>` to the **user address**; specify coin select/split for partial withdraw |
| LOW | Deferral not demonstrable; margin not in sponsor allowlist; 7d-return granularity | 📋 record probe output + dated decision; CC-6; confirm/compute 7d range |

### Phase 7 — Social & Gamification
| Sev | Finding | Resolution |
|---|---|---|
| CRITICAL | Tournament escrow can't be a `PredictManager` | CC-3 ✅ |
| CRITICAL | Agent-copy isn't free reuse of `04` (no mirror path) | ✅ define agent-copy as a one-off copy mint injected into the follower's agent PTB (`request_funds→deposit→mint→emit_action`), budget/expiry/revoke-gated, `action_type=copy`, lands in the agent's own manager |
| HIGH | Streak unit/semantics incomplete (per-position vs per-settlement, calendar gaps) | ✅ one streak event per settled oracle (net WON/LOST by aggregate payout vs cost); dedupe `(userId, oracleId)`; define `totalTrades/totalWins` increments + gap reset rule |
| HIGH | `copy-trade` payload missing `expiry`, `fixedAmount`, `targetId`, `mode` | ✅ extend the `05` job schema accordingly |
| MED | Tournament ranking source/window/grace undefined | ✅ rank from `/positions/(minted\|redeemed)` filtered to `[startTime,endTime]`; rank only after in-window oracles reach SETTLED; define tie-break |
| MED | Copy-job freshness (30s/exposure) at execution | 📋 re-check freshness/ask-bounds/exposure at prompt-build/execution; drop or re-prompt |
| LOW | profile key `telegramId` vs `id` (WhatsApp users); prizePool accrual; escrow test; signal empty-state | 📋 use uuid `userId` for public route; spec prizePool/fee/winner; add escrow fund/payout integration test; `/signal` stale fallback |

### Phase 8 — Leverage + Polish + WhatsApp + SDK + Demo
| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Margin leverage path never specified at call level | ✅ add "Validated Margin facts" (MarginManager/tpsl/Pyth signatures + IDs) and a **Day-1 go/no-go spike** before committing |
| HIGH | Phase 6→8 Margin dependency dangling | ✅ single shared "Margin IDs confirmed" checklist item; if Phase 6 deferred, Part A is future-work by default |
| MED | `action_type=4 (leverage)` doesn't fit the Predict-shaped `ActionExecuted` | ✅ add leverage fields (or a `details` blob) to `ActionExecuted` (note `activity_log` re-deploy); special-case the Phase 5 renderer; exclude leverage rows from leaderboard PnL |
| MED | WhatsApp signing path undefined (no Mini App) | ✅ decide WhatsApp = onboarding/read + tokenized web-signing session (state bound to the WhatsApp number); align acceptance/parity test (not full Mini-App trading) |
| MED | Part A acceptance unfalsifiable (no gate) | ✅ Day-1 prerequisite spike = the go/no-go gate; fallback artifact tied to it |
| LOW | Load-test thresholds + Enoki cap; `@nanawise/keeper` over-claims; tpsl "executes" over-claim | 📋 numeric pass/fail + verify Enoki concurrency; scope `keeper-lib` extraction (decouple persistence); demo claims "sets/shows" TP/SL, not live trigger |

---

## 3. Foundation-doc edits applied
- **`03 §8`** — add `buildDeposit`, `getManagerBalance`/`getPlpBalance`, `previewMintRange`/`previewRedeemRange`, `getAgentActions`, typed `RedeemPermissionlessParams`; pin `OracleState` fields; clarify `mint` takes no `Coin`.
- **`04`** — corrected PTB (deposit-then-mint, mint pulls internal balance), cost buffer ε, escrow-as-meter, redeem→return sweep + revoke reclaim, `PolicyCreated`/`PolicyRevoked` events, mirror trust rule, strategy pure-functions, SVI scaling note.
- **`05`** — add `Redemption` model (+unique), `User.funded/fundedTxDigest`, `Tournament.escrowObjectId`, extended `copy-trade` payload, leverage event fields; SSE/poll note.
- **`06`** — per-phase sponsor allowlist, mandatory `network:testnet`, backend-proxied sponsor key, epoch guard wired into signing.

## 4. Verdict
With CC-1…CC-7 plus the per-phase resolutions, every phase is buildable with no known gaps across backend, frontend, Move, and data. Items marked 📋 are concrete and folded into each phase during build; items marked 🔎 are confirmed against source in §6.

## 6. Source-verified protocol facts

Re-read of `predict-testnet-4-16` (`packages/predict/sources/`, HEAD `1159d79`). These resolve every 🔎 item.

1. **Mint funding (§6.1).** `mint` takes **no `Coin`** — `cost = mul(ask, quantity); manager.withdraw<Quote>(cost, ctx)` (`predict.move:246`). Must `deposit` into the `PredictManager` first (owner-gated). → CC-1 confirmed.
2. **Range redeem (§6.2).** **No** `redeem_range_permissionless`; `redeem_range` asserts `sender == owner` (`predict.move:389`). Keeper auto-settles **binaries only**; settled ranges need an owner-signed claim. → CC-2 confirmed.
3. **Payouts are emitted (§6.3).** `PositionRedeemed { owner, executor, …, quantity, payout, bid_price, is_settled }` (`predict.move:64`); `RangeRedeemed { trader, …, payout, bid_price }` (`predict.move:94`); `PositionMinted`/`RangeMinted` carry `cost` (`predict.move:50/80`). Keeper **reads payout/cost from events** — no recomputation. Resolves Phase 3 payout source.
4. **`redeem_permissionless` (binary).** Settled-only (`assert!(oracle.is_settled())`), no sender check, payout to owner via `deposit_permissionless` (no sender assertion). Confirmed valid for the keeper.
5. **Withdrawal limiter (§6.5).** `RateLimiter { available, last_updated_ms, capacity, refill_rate_per_ms, enabled }`; `consume(amount, clock)` refills then asserts `amount <= capacity` and `amount <= available`. Separate solvency cap: `available = balance − total_max_payout`. Starts disabled until admin enables.
6. **SVI scaling & pricing (§6.6 — important correction).** All SVI params and prices are **1e9 fixed point** (`a,b,sigma:u64`; `rho,m:I64` signed). The surface is **total variance for the tenor** — there is **no** on-chain time/annualization term. On-chain binary price = `N(d2)`, `d2 = -((k + w/2)/√w)`, `w = a + b·(ρ·(k−m) + √((k−m)²+σ²))`, `k = ln(strike/forward)`. `expiry`/timestamps are **milliseconds**; staleness threshold = 30_000 ms. The off-chain feeder pushes variance already scaled to the tenor — our `shared/svi` must mirror `N(d2)` with total variance, **not** a Black-Scholes `IV·√T` form.
