# 03 — DeepBook Predict Integration Reference (Validated)

Everything here is verified against `MystenLabs/deepbookv3` @ `predict-testnet-4-16`, `packages/predict/sources/*.move`, and the official docs. Signatures are the **real** ones — use these, not the ones in the original `IDEA.md`.

> ⚠️ The package address in `Move.toml` is `deepbook_predict = "0x0"` (unpublished). All IDs below come from the docs / env, never the repo.

## 1. Deployment values (testnet, config-driven)

| Key | Value |
|---|---|
| Network | testnet |
| RPC | `https://fullnode.testnet.sui.io:443` |
| predict-server | `https://predict-server.testnet.mystenlabs.com` |
| Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| Predict registry | `0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64` |
| Predict shared object | `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a` |
| dUSDC currency ID | `0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c` |
| dUSDC type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| PLP type | `0xf5ea…5138::plp::PLP` |
| Clock | `0x6` |
| dUSDC faucet | `https://tally.so/r/Xx102L` |

All marked temporary by the docs — they change at mainnet. Keep them in env.

## 2. Modules (package `deepbook_predict`)

`predict`, `predict_manager`, `oracle`, `oracle_config`, `registry`, `vault` (`vault/vault.move`), `plp` (`vault/plp.move`), `market_key`, `range_key`, plus config/helpers (`pricing_config`, `risk_config`, `treasury_config`, `constants`, `i64`, `math`, `rate_limiter`, `strike_matrix`).

## 3. Function signatures (exact)

```move
// predict.move — user/LP entry points
public fun create_manager(ctx: &mut TxContext): ID
public fun get_trade_amounts(predict: &Predict, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock): (u64, u64) // (mint_cost, redeem_payout)
public fun mint<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun redeem<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun redeem_permissionless<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun get_range_trade_amounts(predict: &Predict, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock): (u64, u64)
public fun mint_range<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun redeem_range<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun supply<Quote>(predict: &mut Predict, coin: Coin<Quote>, clock: &Clock, ctx: &mut TxContext): Coin<PLP>
public fun withdraw<Quote>(predict: &mut Predict, lp_coin: Coin<PLP>, clock: &Clock, ctx: &mut TxContext): Coin<Quote>
public fun compact_settled_oracle(predict: &mut Predict, oracle: &OracleSVI, oracle_cap: &OracleSVICap)
public fun ask_bounds(predict: &Predict, oracle_id: ID): (u64, u64)

// predict_manager.move — accessors / funding (ALL owner-gated except where noted)
public fun owner(self: &PredictManager): address
public fun position(self: &PredictManager, key: MarketKey): u64
public fun range_position(self: &PredictManager, key: RangeKey): u64
public fun balance<T>(self: &PredictManager): u64
public fun deposit<T>(self: &mut PredictManager, coin: Coin<T>, ctx: &TxContext)   // sender must be owner
public fun withdraw<T>(self: &mut PredictManager, amount: u64, ctx: &mut TxContext): Coin<T> // sender must be owner

// market_key.move / range_key.move — key constructors
public fun market_key::new(oracle_id: ID, expiry: u64, strike: u64, is_up: bool): MarketKey
public fun market_key::up(oracle_id: ID, expiry: u64, strike: u64): MarketKey
public fun market_key::down(oracle_id: ID, expiry: u64, strike: u64): MarketKey
public fun range_key::new(oracle_id: ID, expiry: u64, lower_strike: u64, higher_strike: u64): RangeKey // asserts lower < higher
```

Notes:
- `mint`/`redeem`/`mint_range`/`redeem_range` are **generic over `Quote`** (pass dUSDC type) and **require the `Clock`**.
- `create_manager` shares the manager and emits `PredictManagerCreated`. It returns the `ID`.
- `supply`/`withdraw` consume/return real `Coin<PLP>` / `Coin<Quote>`.

## 4. Structs

```move
Predict has key (shared):
  id, vault: Vault, treasury_cap: TreasuryCap<PLP>, pricing_config, risk_config,
  treasury_config, oracle_config, withdrawal_limiter: RateLimiter, trading_paused: bool

PredictManager has key (shared):
  id, owner: address, balance_manager: BalanceManager,
  deposit_cap: DepositCap, withdraw_cap: WithdrawCap,         // PRIVATE — no accessor, no delegation
  positions: Table<MarketKey, u64>, range_positions: Table<RangeKey, u64>

OracleSVI has key (shared):
  id, authorized_caps: VecSet<ID>, underlying_asset: String, expiry: u64, active: bool,
  prices: PriceData{ spot, forward }, svi: SVIParams{ a, b, rho, m, sigma },
  timestamp: u64, settlement_price: Option<u64>

SVIParams: a: u64, b: u64, rho: I64, m: I64, sigma: u64       // rho, m are SIGNED (i64)

Vault has store:
  balances: Bag, balance: u64, oracle_matrices: Table<ID, StrikeMatrix>,
  settled_oracles: Table<ID, SettledOracleState>, total_mtm: u64, total_max_payout: u64
  // PLP supply is treasury_cap.total_supply() on Predict, NOT inside Vault

MarketKey: { oracle_id: ID, expiry: u64, strike: u64, direction: u8 }  // UP=0, DOWN=1
RangeKey:  { oracle_id: ID, expiry: u64, lower_strike: u64, higher_strike: u64 }

OracleSVICap has key, store   AdminCap has key, store
Registry has key: { id, predict_id: Option<ID>, oracle_ids: Table<ID, vector<ID>> }
PLP has drop   // 6-decimal coin one-time-witness
```

## 5. Units & pricing

- **dUSDC & PLP: 6 decimals.** `1 dUSDC = 1_000_000`. (`treasury_config` asserts a quote asset has exactly 6 decimals to be enabled.)
- **Quantity:** `1_000_000` quantity = 1 contract = **$1 face value** at settlement.
- **Prices:** `FLOAT_SCALING = 1e9`. `500_000_000` = $0.50 (i.e. 50% implied prob for a binary).
- **Cost:** `cost = math::mul(ask_price_1e9, quantity_1e6)`.
- **Mint price is quoted post-trade** (the trader pays for the liability their mint adds) and is bounded to `[min_ask, max_ask]` (default 1%–99%). Out-of-band → `EAskPriceOutOfBounds`. Because the price is only known *inside* `mint`, callers cannot pre-compute the exact cost — fund with a small buffer (see the agent design `04` for the escrow case).
- **Funding: `mint` spends the manager's INTERNAL balance** via `manager.withdraw<Quote>(cost)` (confirmed `predict.move:246`). `mint`/`mint_range` take **no `Coin` argument** — you must `deposit` dUSDC into the `PredictManager` first (owner-gated). "Spendable balance" = `getManagerBalance(managerId, dUSDC)`, **not** the user's wallet balance.
- **Implied probability (UP)** ≈ `ask_price / FLOAT_SCALING`. For display use the server values or compute from SVI.
- **On-chain pricing (for `shared/svi` parity, verified):** SVI params and prices are **1e9 fixed point**; the surface is **total variance for the tenor** (no time/annualization term on-chain). Binary UP price `= N(d2)`, `d2 = -((k + w/2) / √w)`, `w = a + b·(ρ·(k−m) + √((k−m)² + σ²))`, `k = ln(strike/forward)`. `rho, m` are signed (`I64`). Our `shared/svi` must mirror this `N(d2)` form — **not** a Black-Scholes `IV·√T` form (the feeder pushes variance already scaled to the tenor). `expiry`/timestamps are **milliseconds**.

## 6. Oracle lifecycle & gotchas (must-handle)

Status constants: `INACTIVE=0, ACTIVE=1, PENDING_SETTLEMENT=2, SETTLED=3`; derive via `oracle::status(oracle, clock)`.

| Gotcha | Behavior | Required handling |
|---|---|---|
| **30s staleness** | `mint` asserts `now <= oracle.timestamp + 30_000ms` → `EOracleStale` if feed lags | Pre-check freshness; show "market refreshing, try again"; never auto-retry a stale mint |
| **Pending-settlement freeze** | between expiry and first post-expiry price, ALL trade/redeem revert (`EOracleExpired`) | Disable trade/early-exit UI in this window; tell users "settling now" |
| **Implicit settlement** | no `settle()` call; happens on operator's post-expiry `update_prices`, freezing `settlement_price`, emitting `OracleSettled` | Keeper watches `OracleSettled`; we cannot force it |
| **Exposure cap** | `max_total_exposure_pct` (~80%) can reject a mint regardless of user balance | Surface "vault can't take this now, try smaller/different strike" |
| **Global pause** | `trading_paused` switch | Detect and show maintenance message |
| **Active gate** | `mint` requires status ACTIVE; `redeem` uses `assert_quoteable_oracle` (settled OK, pending rejected) | Choose `redeem` (pre-settlement) vs `redeem_permissionless` (settled) correctly |

## 7. Events

```
oracle::OraclePricesUpdated   oracle::OracleSVIUpdated
oracle::OracleSettled         oracle::OracleActivated
predict::PositionMinted   { predict_id, manager_id, trader(=owner), quote_asset: TypeName,
                            oracle_id, expiry, strike, is_up, quantity, cost, ask_price }
predict::RangeMinted      { ..., quantity, cost, ask_price }
predict::PositionRedeemed { predict_id, manager_id, owner, executor(=tx sender), quote_asset,
                            oracle_id, expiry, strike, is_up, quantity, payout, bid_price, is_settled }
predict::RangeRedeemed    { predict_id, manager_id, trader, quote_asset, oracle_id, expiry,
                            lower_strike, higher_strike, quantity, payout, bid_price, is_settled }
predict::PredictManagerCreated { ... }
```

- **Payouts and costs are emitted on-chain (verified).** `PositionRedeemed.payout` / `RangeRedeemed.payout` carry the settled payout, and `PositionMinted.cost` / `RangeMinted.cost` the premium. The keeper reads these directly — **no off-chain payout recomputation needed**. `executor` enables keeper accounting.
- **Copy-trading** keys off `PositionMinted` (note `trader` = manager owner, not tx sender). There is **no built-in copy function** — we replay into a manager we control (the follower's *agent* manager, or a one-tap owner-signed mint); see Phase 7 + its custody note.

## 8. SDK surface (`@nanawise/predict-sdk`)

```ts
class PredictClient {
  constructor(sui: SuiClient, cfg: { predictObjectId; predictPackageId; serverUrl; dusdcType; clockId })

  // ---- predict-server reads (zod-validated, typed) ----
  getStatus(): Promise<ServerStatus>
  getPredictState(): Promise<PredictState>
  getOracles(): Promise<OracleRef[]>
  getOracleState(oracleId): Promise<OracleState>          // spot, forward, svi, lifecycle, expiry, settlementPrice?
  getAskBounds(oracleId): Promise<{min:number; max:number}>
  getQuoteAssets(): Promise<QuoteAsset[]>
  getVaultSummary(): Promise<VaultSummary>
  getVaultPerformance(range='ALL'): Promise<VaultPerf>
  getLpSupplies(): Promise<LpEvent[]>; getLpWithdrawals(): Promise<LpEvent[]>
  getManagerSummary(id): Promise<ManagerSummary>
  getManagerPositions(id): Promise<PositionSummary>
  getManagerPnl(id, range='ALL'): Promise<PnlHistory>
  getOraclePrices(id): Promise<PricePoint[]>; getOraclePriceLatest(id): Promise<PricePoint>
  getOracleSvi(id): Promise<SviPoint[]>;  getOracleSviLatest(id): Promise<SviPoint>
  getPositionsMinted(q?): Promise<MintRecord[]>; getPositionsRedeemed(q?): Promise<RedeemRecord[]>
  getRangesMinted(q?): Promise<RangeMintRecord[]>; getRangesRedeemed(q?): Promise<RangeRedeemRecord[]> // NEW
  getTrades(oracleId): Promise<Trade[]>

  // ---- on-chain reads ----
  readManager(id): Promise<ManagerObject>     // SuiClient.getObject, parsed
  getManagerBalance(managerId, coinType): Promise<bigint>  // spendable balance INSIDE the manager (what mint spends)
  getPlpBalance(owner): Promise<bigint>       // getBalance({owner, coinType: PLP}) — PLP is a USER-HELD coin, not in the manager
  readAgentPolicy(id): Promise<AgentPolicyState>          // budget-escrow object (Phase 4)
  readRateLimiter(): Promise<RateLimiterState>            // withdrawal-limiter fields (Phase 6)
  getAgentActions(policyId): Promise<AgentAction[]>       // backend API over the Postgres ActionExecuted mirror (Phase 4/5)
  marketKey(oracleId, expiry, strike, isUp): MarketKeyArg
  rangeKey(oracleId, expiry, lower, higher): RangeKeyArg

  // ---- previews (wrap get_trade_amounts / get_range_trade_amounts; read-only) ----
  previewMint(p: MintParams): Promise<{cost: bigint; payout: bigint; impliedProb: number}>
  previewRedeem(p: RedeemParams): Promise<{payout: bigint}>
  previewMintRange(p: RangeMintParams): Promise<{cost: bigint; payout: bigint}>
  previewRedeemRange(p: RangeRedeemParams): Promise<{payout: bigint}>
  assertTradable(o: OracleState): void        // throws STALE(>30s)/NOT_ACTIVE/PENDING/SETTLED/PAUSED (pre-checks)
  mapExecutionError(abortCode): string        // EAskPriceOutOfBounds / exposure / EOracleStale → human message (post-trade aborts)

  // ---- PTB builders (return unsigned Transaction; never sign/sponsor here) ----
  buildCreateManager(tx?): Transaction
  buildDeposit(p: {managerId; coinType; amount; coin?}, tx?): Transaction  // REQUIRED before mint — mint spends the manager's INTERNAL balance, it takes no Coin
  buildMint(p: MintParams, tx?): Transaction                 // compose after buildDeposit if the manager isn't already funded
  buildRedeem(p: RedeemParams, tx?): Transaction
  buildRedeemPermissionless(p: RedeemPermissionlessParams, tx?): Transaction  // BINARY only; p.managerId = OWNER's manager, signer = keeper
  buildMintRange(p: RangeMintParams, tx?): Transaction
  buildRedeemRange(p: RangeRedeemParams, tx?): Transaction    // OWNER-gated — NO permissionless/keeper path for ranges
  buildSupply(p: SupplyParams, tx?): Transaction
  buildWithdraw(p: WithdrawParams, tx?): Transaction
}

interface MintParams { managerId; oracleId; expiry: bigint; strike: bigint; isUp: boolean; quantity: bigint /* 1e6 units */ }
interface RedeemPermissionlessParams { managerId /* the OWNER's manager */; oracleId; expiry: bigint; strike: bigint; isUp: boolean; quantity: bigint }
```

**Builder rule:** builders accept an optional existing `tx` so callers can compose (e.g. the agent PTB chains `request_funds` + `mint` + `emit_action`). They construct `MarketKey`/`RangeKey` via the `market_key`/`range_key` modules, pass the `<Quote>` type arg, and include the `Clock`.

## 9. PTB patterns (from deepbook-sandbox, adapted)

- **Curried/raw moveCall.** Build with `tx.moveCall({ target, typeArguments, arguments })`; reuse returned `TransactionResult`s across calls in one PTB (this is how the agent chains escrow→mint).
- **Read created object IDs from effects** using `include:{effects:true}` and filter `changedObjects` for `idOperation === 'Created'` with an **anchored** type regex (`::PredictManager(<|$)`) — substring matching caused real bugs in the sandbox.
- **Always `waitForTransaction(digest)` before a dependent read** — indexing lag is real.
- **Manifest/config-driven IDs** — never hard-code.
- **Funding transfers** mirror the sandbox `coinWithBalance` + signing-lock faucet pattern for the dUSDC hot wallet.

## 10. What the protocol does NOT give us (build ourselves)

- No delegation/TradeCap for trading on another's manager (drives the agent design — `04`).
- **No permissionless RANGE redeem.** `redeem_permissionless` is binary-only; `redeem_range` is owner-gated (`predict.move:389`). The keeper auto-settles **binaries only**; settled ranges require an owner-signed claim (Phase 3).
- No copy function, no settlement trigger, no leverage on Predict.
- No documented predict-server auth, rate-limits, pagination, or response schemas → validate at runtime, fail soft.

## 11. Withdrawal limiter (verified — for Phase 6)

`Predict.withdrawal_limiter: RateLimiter { available, last_updated_ms, capacity, refill_rate_per_ms, enabled }`. On `withdraw`, `consume(amount, clock)` refills (`available += elapsed_ms · refill_rate_per_ms`, capped at `capacity`) then asserts `amount <= capacity` and `amount <= available`. A **separate** solvency cap also applies: `available_to_withdraw = vault.balance − total_max_payout`. So `maxWithdrawable = min(vault.balance − total_max_payout, limiter.available_now)`. The limiter starts disabled until an admin enables it; deposits (`supply`) partially replenish the budget.
