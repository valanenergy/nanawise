# Phase 0 — Foundation & Protocol Spike

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 0, §1 CC-1) before building. Key correction: `mint` spends the manager's internal balance → `buildDeposit` is required.

**Goal:** Stand up the monorepo and the SDK skeleton, then **prove the DeepBook Predict integration end-to-end with a throwaway script that mints one real position on testnet** — before any UI exists. This de-risks every later phase: if the real signatures, units, `MarketKey`, `Clock`, and oracle gates don't behave as `03` says, we find out now.

**Depends on:** nothing.

## Scope

**In:** monorepo tooling, `packages/shared` (config + constants + units + SVI math stub), `packages/predict-sdk` (server reads + `create_manager`/`mint`/`get_trade_amounts` builders), a CLI spike that funds → creates manager → previews → mints → reads back, all on testnet with a plain keypair.

**Out:** zkLogin, sponsorship, bot, web, keeper, agent, range/supply/withdraw builders (added in later phases).

## Components

### Tooling / repo
- pnpm workspaces; TypeScript (strict); ESLint + Prettier; `tsx` for scripts; `vitest`.
- `pnpm-workspace.yaml` listing `apps/*`, `packages/*`.
- Root scripts: `build`, `lint`, `test`, `spike`.
- `infra/docker-compose.yml` (Redis + Postgres) for later phases (stub now).
- `.env.example` mirroring `06`'s variable list; `.gitignore` already present.

### `packages/shared`
- `config.ts` — zod schema → `loadConfig()` returning typed `{ sui, predict, dusdcType, clockId, ... }` from env. Fails fast with a readable error listing missing keys.
- `constants.ts` — action-type enums, status enums (`INACTIVE/ACTIVE/PENDING/SETTLED`), float scaling (`1e9`), dUSDC decimals (`6`).
- `formatting.ts` — `parseUsdc(human)→bigint`, `formatUsdc(base)→string`, `formatStrike`, `priceToImpliedProb(ask_1e9)`.
- `svi.ts` — stub the SVI functions with signatures and TODO bodies (full impl in Phase 4); export `totalVariance`, `impliedVol`, `binaryUpPrice`.

### `packages/predict-sdk`
- `types.ts` — typed interfaces for `OracleState`, `SVIParams`, `ManagerSummary`, `PositionSummary`, `VaultSummary`, `MintParams`, etc. (per `03 §8`).
- `validate.ts` — zod schemas mirroring the typed interfaces; a `safeFetch(url, schema)` helper with timeout + one retry + typed error.
- `server.ts` — REST wrappers for at least: `getOracles`, `getOracleState`, `getAskBounds`, `getManagerSummary`, `getManagerPositions`. (Remaining endpoints stubbed.)
- `ptb.ts` — builders: `buildCreateManager`, `buildMint`, plus `marketKey(...)` helper. Each constructs the real Move call from `03 §3` (generic `<Quote>`, `MarketKey`, `Clock`). Builders accept an optional `tx` for composition.
- `client.ts` — `PredictClient` wiring `SuiClient` + config + server + builders. `readManager(id)` parses the on-chain object. `waitFor(digest)` helper.

### Spike (`scripts/spike-mint.ts`)
A standalone script (NOT shipped) using a local funded keypair:
1. Load config; build `SuiClient`.
2. Request dUSDC for the keypair (manual faucet form once; document the address used).
3. `create_manager` → read created `PredictManager` ID from effects (anchored type regex, `idOperation==='Created'`).
4. `deposit<DUSDC>` into the manager.
5. `getOracles` → pick the active BTC oracle; `getOracleState` → confirm `ACTIVE` and fresh (<30s); read spot/expiry/an ATM strike.
6. `get_trade_amounts` preview for an ATM UP at a small quantity → log `(mint_cost, redeem_payout)`.
7. Build & submit `mint<DUSDC>`; `waitForTransaction`.
8. `readManager` → assert the position quantity is present in `positions` table; print the TX hash + explorer URL.

## Interfaces produced (consumed by later phases)
- `loadConfig()` and the constants/formatting helpers.
- `PredictClient` with `buildCreateManager`, `buildMint`, `marketKey`, `getOracleState`, `getManagerPositions`, `readManager`, `waitFor`.

## Acceptance criteria
- `pnpm spike` produces, on testnet: a `create_manager` TX, a `mint` TX, and a confirmed position quantity read back from the manager — with both TX hashes printed and viewable on `testnet.suivision.xyz`.
- Confirms empirically: real `mint` signature, dUSDC 6-decimals, quantity `1e6`=$1, the `Clock` requirement, `ACTIVE`+freshness gating, and that positions are table quantities (no standalone object).
- `pnpm lint` and `pnpm test` pass; `loadConfig()` rejects a missing-env case with a clear message.

## Test plan
- Unit: `formatting` round-trips; `validate` accepts a recorded sample response and rejects a malformed one; `marketKey` produces the expected BCS arg.
- Integration (manual, recorded): the spike run, with output saved to `docs/artifacts/phase-0-spike.log` (gitignored) and TX hashes pasted into the phase checklist.

## Risks
| Risk | Mitigation |
|---|---|
| Real signatures differ from `03` despite validation | The spike exists precisely to catch this on day one; fix `predict-sdk`/`03` before proceeding |
| No active oracle when running the spike | Poll `getOracles`; document expiry cadence observed; retry near a fresh cycle |
| dUSDC faucet latency | Request early; reuse one funded dev address for the spike |
| predict-server shape surprises | zod surfaces it immediately; fall back to chain reads |
