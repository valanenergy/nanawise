# 01 — Validity Audit & Decisions

Every material claim in the original `IDEA.md` was checked against primary sources: the actual `predict-testnet-4-16` Move source (`MystenLabs/deepbookv3`, `packages/predict`), the official Sui docs (`docs.sui.io/onchain-finance/deepbook-predict`), the `deepbook-sandbox` repo, the DeepBook Margin source/docs, and the Sui zkLogin + Enoki docs. This document records what is true, what is wrong, and the decisions taken in response.

---

## 1. Confirmed accurate

The original spec is unusually well-grounded. The following were verified exact:

- **Deployment values** (all exact matches in `…/deepbook-predict/contract-information`): predict-server URL, Predict package `0xf5ea…5138`, registry `0x43af…6e64`, shared object `0xc873…028a`, dUSDC currency `0xf300…3e9c`, dUSDC type `0xe950…::dusdc::DUSDC` (6 decimals), PLP type `<predict_pkg>::plp::PLP`, faucet form `https://tally.so/r/Xx102L`, branch `predict-testnet-4-16`.
- **All ~21 predict-server endpoints** the spec lists exist with the documented paths.
- **Core objects & functions exist** with the behavior described: `create_manager`, `mint`, `redeem`, `redeem_permissionless`, `mint_range`, `redeem_range`, `supply`, `withdraw`, `get_trade_amounts`, `get_range_trade_amounts`, `compact_settled_oracle`.
- **Oracle lifecycle** Inactive → Active → Pending settlement → Settled, with settlement frozen on the first post-expiry price push.
- **Events** `oracle::OraclePricesUpdated/OracleSVIUpdated/OracleSettled/OracleActivated` exist; `predict::PositionMinted` exists (so copy-trading is feasible at the data level).
- **Keeper design is valid as-is**: `redeem_permissionless` truly lets *any* caller redeem a *settled* position into the owner's manager.
- **zkLogin/Enoki flow is mostly correct**: nonce ordering, salt stability, the `onlyTransactionKind` → sponsor → sign → execute sponsorship pattern.

---

## 2. Critical problems and how we fixed them

### 2.1 🔴 The agent-wallet design cannot work as written

**Finding.** Every state-changing user action in `predict.move` begins with `assert!(ctx.sender() == manager.owner(), ENotOwner)` — confirmed at `mint` (~line 228), `redeem` (~294), `mint_range` (~340), `redeem_range` (~389). The funding step inside `mint` calls `manager.withdraw<Quote>(cost, ctx)`, and `predict_manager::withdraw` *also* asserts the sender is the owner. The `PredictManager` mints its own `DepositCap`/`WithdrawCap` at creation and stores them as **private fields with no accessor** — there is no `mint_trade_cap`, no `&mut balance_manager` borrow, and no delegation API. The underlying DeepBook `BalanceManager` supports `TradeCap` delegation, but the Predict wrapper deliberately neutralizes it.

**Consequence.** The original design (a separate "agent keypair" calling `execute_with_policy` with `sender == agent` and then `predict::mint` with `sender == owner`) can **never** pass both checks in one PTB. The entire Agentic Web track, as specified, is non-functional.

**The only non-owner path** is `redeem_permissionless` (settled positions only) — which validates the keeper, but not the agent.

**Decision (chosen).** **Agent-owned manager + on-chain budget escrow.** The agent has its *own* `PredictManager` (it is the owner, so its trades pass the check). A custom `AgentPolicy` Move object **custodies** the user's budget and releases dUSDC **per trade** only to the agent, enforcing the cap, expiry, and revocation inside the Move VM. The user can revoke and reclaim unspent funds instantly. This is genuinely trustless and is the strongest possible Agentic Web story. Full design in [`04-agent-wallet-design.md`](./04-agent-wallet-design.md).

### 2.2 🔴 "Self-custodial / no keys involved" is inaccurate

**Finding.** zkLogin always involves an **ephemeral Ed25519 key**. The original plan stored it server-side in Redis, which makes the bot able to sign as any user for the session window — that is *session-server-custodial*, not self-custodial. Also: the spec claimed silent session refresh, but refresh **requires a fresh Google JWT** (~every 1–2 days). Enoki specifics were slightly off: endpoints need the `/v1` prefix, the second "execute" call (`POST /v1/transaction-blocks/sponsor/{digest}`) was missing, and the browser-only `registerEnokiWallets` is not usable from a bot backend (use `EnokiClient`/`EnokiFlow` + REST).

**Decision.** Two corrections:
1. **Hold the ephemeral key client-side in the Mini App** (session storage), so user trades are genuinely self-custodial. The backend holds only the Enoki **sponsor private key**. (This is enabled by decision 3 — the Mini App.)
2. **Reframe the pitch** to "no seed phrase, no gas, Google sign-in" rather than "self-custodial / no keys." Plan for non-silent re-auth every ~1–2 days with a graceful "tap to re-link Google" path.

Corrected Enoki integration is specified in [`02-architecture.md`](./02-architecture.md) and [`phases/phase-1-wallet-auth.md`](./phases/phase-1-wallet-auth.md).

---

## 3. Smaller corrections (baked into the protocol reference)

All captured in detail in [`03-protocol-integration.md`](./03-protocol-integration.md):

- **`mint` signature differs.** It is `mint<Quote>(predict, manager, oracle, key: MarketKey, quantity, clock, ctx)` — expiry/strike/is_up are bundled into a `MarketKey` (built via `market_key::new/up/down`), it is generic over `Quote`, and it requires the `Clock` (`0x6`). Same shape for ranges (`RangeKey`). The original `mint(predict, manager, oracle, expiry, strike, is_up, quantity)` is wrong.
- **`MarketKey` uses `direction: u8`** (UP=0, DOWN=1), not `is_up: bool`.
- **Oracle staleness gate.** `mint` requires status ACTIVE *and* `now <= oracle.timestamp + 30_000ms`; a feed lag >30s makes mints revert (`EOracleStale`). UX must surface "oracle stale → can't trade right now."
- **Pending-settlement freeze.** Between expiry and the first post-expiry price, **all** trading and redeeming is frozen (`EOracleExpired`). Users cannot early-exit in that window.
- **Settlement is implicit.** There is no `settle()` entry point; settlement is a side effect of the operator's post-expiry `oracle::update_prices`. We cannot trigger it — the keeper watches for `OracleSettled`.
- **Mint pricing is post-trade and bounded** to `[min_ask, max_ask]` (default 1%–99%, `EAskPriceOutOfBounds`); there is a global `trading_paused` switch and a `max_total_exposure_pct` (default ~80%) that can independently make mints revert.
- **Units.** dUSDC and PLP are 6 decimals. Quantity `1_000_000` = 1 contract = $1 face value. Prices use `FLOAT_SCALING = 1e9` (`500_000_000` = $0.50). `cost = mul(ask_1e9, quantity_1e6)`.
- **Missed endpoints.** `/ranges/minted` and `/ranges/redeemed` (range history) exist and were omitted. `?range=ALL` applies to `/vault/performance` and `/managers/:id/pnl`.
- **predict-server has no documented auth / rate-limit / pagination / response schemas.** Build defensively; wrap all calls in a versioned SDK with runtime validation (zod).
- **BTC-only and sub-hour expiry are observed, not documented.** Treat as empirical; do not hard-code an underlying — read oracles dynamically.
- **`PredictManager` is created by whoever signs `create_manager`** (owner = sender, immutable). This is the lever for the agent escrow design.
- **`Predict` package address is `0x0` (unpublished) in `Move.toml`.** Testnet IDs come from the docs/env, never from the repo.

---

## 4. Margin opportunity (decision 2)

**Finding.** DeepBook Margin is a *separate* product: leveraged spot trading on DeepBook order books backed by single-asset lending pools, priced by **Pyth** (5-min max age, 5% tolerance), with permissionless liquidation and on-chain TP/SL (`tpsl.move`). There is **no existing Margin↔Predict integration** (`grep` for `predict`/`plp` in margin packages → zero hits). PLP is a real `Coin<PLP>` but has **no Pyth feed**, so it cannot be dropped into a margin pool as collateral.

**Ranked options:**
1. **dUSDC lending pool** — supply idle dUSDC for yield. Audited, low-risk, oracle-light on the supply side. **In scope.**
2. **Agent bounded leverage on spot** (e.g. SUI/USDC ≤2x) with on-chain TP/SL. More wow, needs Pyth wiring + inherits liquidation risk. **In scope, demo slice only.**
3. Margin-borrowed dUSDC → Predict positions — novel, requires a custom bridge + custom risk model. **Out of scope.**
4. Borrow against PLP — blocked (no Pyth feed for PLP). **Out of scope.**

**Note.** The margin packages live on the repo's `main` branch (the agent that checked could not find them on `predict-testnet-4-16`). We must confirm the correct branch/package IDs for whatever margin pool we point at, and externalize them as config like everything else.

**Decision (chosen).** Option 1 (Phase 6) + Option 2 demo slice (Phase 8).

---

## 5. The four decisions (final)

| # | Decision | Choice | Where specified |
|---|---|---|---|
| 1 | Agent enforcement | **Agent-owned manager + Move budget escrow** | `04-agent-wallet-design.md`, Phase 4 |
| 2 | Margin scope | **dUSDC lending (Phase 6) + agent ≤2x leverage demo (Phase 8)** | Phases 6 & 8 |
| 3 | UX surface | **Hybrid: chat-first bot + Telegram Mini App (client-held keys)** | `02-architecture.md`, Phases 1/2/5 |
| 4 | Docs format | **Phase-based vertical slices** | this folder |

---

## 6. Source map (for re-verification)

| Topic | Primary source |
|---|---|
| Predict Move source | `MystenLabs/deepbookv3` @ `predict-testnet-4-16`, `packages/predict/sources/*.move` |
| Predict docs & IDs | `https://docs.sui.io/onchain-finance/deepbook-predict/` (+ `/contract-information/*`, `/design`) |
| predict-server API | `…/contract-information` (paths only; no schema/auth/rate-limit documented) |
| Margin | `…/deepbook_margin/sources/*` (repo `main`); `https://docs.sui.io/onchain-finance/deepbook-margin` |
| SDK / PTB patterns | `MystenLabs/deepbook-sandbox` (spot only; `@mysten/sui` v2 + `@mysten/deepbook-v3`) |
| zkLogin | `https://docs.sui.io/concepts/cryptography/zklogin`, `…/guides/developer/cryptography/zklogin-integration` |
| Enoki | `https://docs.enoki.mystenlabs.com/` (`/http-api/openapi`, `/ts-sdk/*`) |
