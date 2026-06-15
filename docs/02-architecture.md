# 02 — System Architecture

## Surfaces

Nanawise presents **four surfaces** over one shared backend and one shared on-chain state.

```
┌────────────────────────┐   ┌────────────────────────┐
│   Telegram Bot (grammy)│   │  WhatsApp (Twilio)     │  ← Phase 8
│   chat-first commands  │   │  plain-text formatter  │
└───────────┬────────────┘   └───────────┬────────────┘
            │  deep-links to sign / rich UI            │
┌───────────▼──────────────────────────────────────────▼─┐
│         Telegram Mini App  +  Web Dashboard             │
│         (Next.js, one app — apps/web)                   │
│  client-held ephemeral key · trade signing · charts ·   │
│  vault · agent dashboard · standalone wallet (dApp Kit) │
└───────────┬─────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────┐
│        BACKEND (Node 20, pnpm monorepo)                  │
│  apps/bot     — command handlers, sessions, webhooks     │
│  apps/keeper  — settlement watcher, redeemer, notifier,  │
│                 agent loop, copy-trade, signal cron      │
│  packages/predict-sdk — protocol API + PTB builders      │
│  packages/sui-auth    — Enoki sponsor + zkLogin helpers  │
│  packages/shared      — constants, formatting, SVI math  │
│  Redis (sessions, queues, caches) · Postgres (Prisma)    │
└───────────┬─────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────┐
│                    SUI TESTNET                           │
│  DeepBook Predict (predict-testnet-4-16)                 │
│  agent_policy + activity_log (our Move packages)         │
│  DeepBook Margin MarginPool<DUSDC> (Phases 6/8)          │
└───────────┬─────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────┐
│  DATA: predict-server (indexed reads) · Sui event stream │
│  (live oracle/settlement events) · Enoki (sponsor/ZKP)   │
│  · Pyth (margin only) · Polymarket REST (signal)         │
└─────────────────────────────────────────────────────────┘
```

## Custody model (corrected)

This is the single most important architectural correction (see `01 §2.2`).

- **User trades are self-custodial.** The zkLogin **ephemeral key is generated and held client-side** in the Mini App (browser session storage). The Mini App signs the user's transactions. The backend never sees the ephemeral private key.
- **Gas is sponsored.** The backend holds only the Enoki **sponsor private key** and sponsors transactions (`onlyTransactionKind` → `POST /v1/transaction-blocks/sponsor` → user signs → `POST /v1/transaction-blocks/sponsor/{digest}`).
- **Signing flow.** Read-only commands run in chat. Any state-changing action (mint, redeem, supply, policy create/revoke) opens the Mini App via a Telegram inline button (a Web App button), where the user reviews and signs with the client-held key.
- **The agent never uses user keys.** It has its own keypair + manager + escrow (see `04`).
- **The keeper never uses user keys.** `redeem_permissionless` is permissionless.
- **Re-auth is explicit.** Ephemeral keys expire at `maxEpoch` (~24h/epoch; we use `current + 2` ≈ 48h). When expired, the Mini App prompts a fresh Google sign-in. The bot detects an expired session and sends a "tap to re-link Google" button.
- **Address stability.** Enoki owns the salt; the same Google account + same Enoki app (same `aud`) yields the same Sui address in the bot, the Mini App, and the standalone dashboard. We never mint our own salt.

> **Optional "fast mode" (documented, off by default):** a user may opt into a server-held session key for one-tap chat trading. This is explicitly disclosed as a convenience-for-custody tradeoff and is not the default. Not built before Phase 8 polish, if at all.

## Monorepo layout

```
nanawise/                         # pnpm workspaces
├── apps/
│   ├── bot/                      # Telegram (+ WhatsApp) — grammy
│   │   └── src/{commands,conversations,keyboards,middleware,webhooks}
│   ├── web/                      # Next.js 14 — Mini App + dashboard + auth callback
│   │   └── app/{(auth),(market),(portfolio),(vault),(leaderboard),(agent),miniapp}
│   └── keeper/                   # settlement + agent + copy-trade + signal
│       └── src/{watcher,redeemer,notifier,agent,copytrade,signal}.ts
├── packages/
│   ├── predict-sdk/              # @nanawise/predict-sdk (public npm)
│   │   └── src/{client,server,ptb,types,validate}.ts
│   ├── sui-auth/                 # @nanawise/sui-auth (Enoki sponsor, session)
│   │   └── src/{enoki,sponsor,session,nonce}.ts
│   ├── keeper-lib/               # @nanawise/keeper (public npm, Phase 8)
│   └── shared/                   # constants, formatting, svi math, env schema
│       └── src/{constants,config,formatting,svi,types}.ts
├── move/
│   ├── agent_policy/sources/agent_policy.move
│   └── activity_log/sources/activity_log.move
├── infra/{docker-compose.yml,railway.toml,prisma/schema.prisma}
├── pnpm-workspace.yaml
└── package.json
```

## Component responsibilities & interfaces

### `packages/shared`
- **Owns** all constants, the env/config schema (zod), human↔base-unit formatting, and the SVI math library.
- **Interface:** `loadConfig()` returns a validated, typed config object from env. `formatUsdc`, `parseUsdc`, `formatStrike`. `svi.totalVariance(k, params)`, `svi.impliedVol(...)`, `svi.binaryUpPrice(...)`.
- **Depends on:** nothing internal.

### `packages/predict-sdk`
- **Owns** all DeepBook Predict access: typed predict-server REST wrappers (with zod validation) and PTB builders.
- **Interface:** `PredictClient` (see `03 §7`). PTB builders return a `Transaction` (unsigned) so callers control signing/sponsorship.
- **Depends on:** `@mysten/sui`, `shared`.
- **Boundary rule:** the SDK never signs or sponsors. It only reads and builds transactions.

### `packages/sui-auth`
- **Owns** Enoki sponsorship and zkLogin helpers usable from a server.
- **Interface:** `buildNonce(ephPubkey, maxEpoch, randomness)`, `getZkLogin(jwt)`, `getZkp(...)`, `sponsorAndExecute(tx, { sender, userSignature })`. Uses `EnokiClient` (private key) server-side.
- **Depends on:** `@mysten/enoki`, `@mysten/sui`, `shared`.

### `apps/bot`
- **Owns** the chat UX: command routing, inline keyboards, session middleware (Redis), Mini App deep-links, error formatting, platform detection (TG/WhatsApp).
- **Depends on:** `predict-sdk`, `sui-auth`, `shared`, Redis, Postgres.

### `apps/web`
- **Owns** the Mini App (onboarding, client-held key, signing) + the dashboard pages + the OAuth callback page.
- **Depends on:** `predict-sdk`, `@mysten/dapp-kit`, `@mysten/enoki`, `shared`.

### `apps/keeper`
- **Owns** all background on-chain work: event subscription, batch redeem, settlement notifications, the agent strategy loop, copy-trade execution, and the signal cron.
- **Depends on:** `predict-sdk`, `shared`, Redis, Postgres, its own keeper + agent keypairs.

## Data flow examples

**Onboarding (`/start`):** Bot → Mini App link → user Google sign-in (nonce precomputed client-side) → Enoki ZKP → client builds `create_manager` PTB → backend sponsors → user signs → execute → backend records `{telegram_id, sui_address, manager_id}` in Postgres → hot wallet sends 100 dUSDC (sponsored PTB) → bot welcome.

**Trade (`/up`):** Bot deep-links Mini App with strike/amount → client `get_trade_amounts` preview → client builds `mint` PTB → backend sponsors → user signs → execute → Mini App shows confirmation + TX → bot posts result card.

**Settlement:** Keeper watcher sees `OracleSettled` → fetch unredeemed positions (`/positions/minted?...`) → batch `redeem_permissionless` (≤20/PTB, keeper gas) → push DM jobs → bot worker sends settlement DMs → update streaks.

**Agent trade:** Keeper agent loop sees `OracleActivated` → reads SVI → picks strike → builds PTB `[agent_policy::request_funds → deposit into agent manager → predict::mint → activity_log::emit_action]` → signs with agent key → execute. Budget enforced in-Move; revocation checked in-Move.

## Cross-cutting concerns

- **Config:** every on-chain ID, URL, and key comes from validated env (`shared/config`). No magic strings in code.
- **Resilience:** all predict-server reads go through the SDK with zod validation, timeouts, one retry, and typed errors. `waitForTransaction` before any dependent read (indexing lag is real — observed in the sandbox).
- **Observability:** structured logs; the keeper alerts when the hot wallet or keeper SUI balance is low.
- **Security:** see [`06-infrastructure-security.md`](./06-infrastructure-security.md).
