# Nanawise — Build Documentation

This folder is the complete, validated build plan for **Nanawise**, a consumer trading product on **DeepBook Predict** (Sui). It turns the original `IDEA.md` vision into a buildable, dependency-ordered plan with every protocol assumption verified against the actual `predict-testnet-4-16` Move source, the official Sui docs, the deepbook-sandbox, DeepBook Margin, and the zkLogin/Enoki docs.

> **Status:** Pre-build planning. No code written yet. These docs are the contract for what we build.

## How to read these docs

Read in this order. The foundation docs (00–06) are the shared source of truth; the phase specs depend on them.

| Doc | What it covers |
|---|---|
| [`00-overview.md`](./00-overview.md) | Product, target tracks, scope, and the decisions that shaped this plan |
| [`01-validity-and-decisions.md`](./01-validity-and-decisions.md) | The full validity audit of `IDEA.md` vs. reality, plus the four architecture decisions and every correction baked into this plan |
| [`02-architecture.md`](./02-architecture.md) | System architecture: surfaces, custody model, data flow, monorepo layout, components and their interfaces |
| [`03-protocol-integration.md`](./03-protocol-integration.md) | Validated DeepBook Predict reference: exact function signatures, `MarketKey`/`RangeKey`, units/decimals, oracle lifecycle, and every gotcha |
| [`04-agent-wallet-design.md`](./04-agent-wallet-design.md) | The corrected on-chain agent-wallet design (escrow model) and the `agent_policy` + `activity_log` Move specs |
| [`05-data-architecture.md`](./05-data-architecture.md) | Redis keys, Postgres schema, and the on-chain vs. off-chain data decisions |
| [`06-infrastructure-security.md`](./06-infrastructure-security.md) | Deployment topology, environment variables, secrets handling, and security hardening |
| [`07-review-findings-and-resolutions.md`](./07-review-findings-and-resolutions.md) | **Plan review:** all nine phases were gap-audited (backend/frontend/Move/data) — every finding + its resolution, plus source-verified protocol facts. Read before building any phase. |

## Phase specs

Each phase is a **shippable vertical slice** with a full spec: scope, dependencies, backend + frontend + Move + data work, interfaces, acceptance criteria, test plan, and risks.

| Phase | File | Slice |
|---|---|---|
| 0 | [`phases/phase-0-foundation.md`](./phases/phase-0-foundation.md) | Monorepo, SDK skeleton, **testnet mint spike** |
| 1 | [`phases/phase-1-wallet-auth.md`](./phases/phase-1-wallet-auth.md) | zkLogin + Enoki + Mini App onboarding |
| 2 | [`phases/phase-2-core-trading.md`](./phases/phase-2-core-trading.md) | Mint/redeem/range, market, PnL |
| 3 | [`phases/phase-3-keeper-settlement.md`](./phases/phase-3-keeper-settlement.md) | Keeper, batch redeem, settlement DMs |
| 4 | [`phases/phase-4-agent-wallet.md`](./phases/phase-4-agent-wallet.md) | On-chain agent wallet + strategies |
| 5 | [`phases/phase-5-web-dashboard-miniapp.md`](./phases/phase-5-web-dashboard-miniapp.md) | Full dashboard / Mini App |
| 6 | [`phases/phase-6-vault-lp-margin.md`](./phases/phase-6-vault-lp-margin.md) | Vault/LP + Margin lending |
| 7 | [`phases/phase-7-social-gamification.md`](./phases/phase-7-social-gamification.md) | Streaks, cards, tournaments, copy-trade, signal |
| 8 | [`phases/phase-8-leverage-polish-launch.md`](./phases/phase-8-leverage-polish-launch.md) | Agent leverage, WhatsApp, SDK release, demo |

## Conventions used across these docs

- **Validated** = checked against the actual source/docs (see `01`). Anything not validated is flagged as an assumption.
- All on-chain IDs are **config/env-driven**, never hard-coded — they change at mainnet.
- Money is always shown to users in human units; code uses base units (dUSDC = 6 decimals, so `1 dUSDC = 1_000_000`).
- Each phase ends with **acceptance criteria** that must be demonstrable on testnet with a real TX hash.
