# Nanawise

**Prediction markets your grandma can actually use.** Trade BTC up/down (and ranges) on
**DeepBook Predict** from inside Telegram — by **typing a hunch in plain English or
sending a voice note**. No seed phrase, no gas, no order tickets, no jargon. An LLM reads
the live vol-surface market, builds a valid on-chain position, and hands you one tap to pay.

> Built on **DeepBook Predict** (`predict-testnet-4-16`), live on **Sui testnet**.
> Self-custodial (zkLogin), gas-sponsored (Enoki), AI-driven (gpt-4o + voice).
> Bot: **[@nana_wise_bot](https://t.me/nana_wise_bot)**

---

## The problem

Prediction markets today are fragmented and shallow — narrow hand-listed binaries, slow
settlement, no real volatility surface. DeepBook Predict fixes the *protocol* layer
(every strike/expiry priced against a live SVI surface, sub-hour rolling oracles, a PLP
vault that takes the other side). But there's a second wall: **the UX is built for quants.**
A normal person can't open a wallet, buy gas, learn "strike / ask-bounds / expiry," and not
fat-finger a reverting trade. So the audience stays tiny.

## The solution — Nanawise

A **chat-first, AI-driven Predict client** that removes every barrier at once:

| Barrier | Nanawise |
|---|---|
| Seed phrase / wallet | **Google sign-in → zkLogin** self-custody wallet (keys stay on device) |
| Gas / tokens | **Enoki sponsors gas**; you start with zero SUI |
| Jargon / charts | **Say it in words or voice** — "bet $1 BTC goes up this hour" |
| Picking a valid strike | The agent reads the live oracle and only offers **in-band, tradeable** strikes (never a guaranteed revert) |
| Deposit → mint dance | One **"💸 Open — pay X dUSDC"** button does it all, sponsored |

This is the track's **idea-bank #5 (Telegram Quick-Predict Bot)** taken further with
**natural-language + voice** trading, plus streaks/leaderboards (#6), a PLP vault, an
on-chain auto-trading agent, and a settled-redeem keeper.

---

## Test it end-to-end (60 seconds)

Open **[@nana_wise_bot](https://t.me/nana_wise_bot)** in Telegram.
*(Hosted Mini App runs behind an ngrok tunnel that rotates — if a button is dead, ping us
for a fresh link or run locally, see [Run it](#run-it).)*

1. **`/start`** → **Sign in with Google** → zkLogin wallet + `PredictManager` created
   on-chain, **gas sponsored** (no seed phrase, no SUI).
2. Type a hunch — **no command needed**: `bet $1 that bitcoin goes up in the next hour`
   → the AI prices it on-chain and replies with the reasoning **+ a pay button**.
3. Tap the button → Mini App runs **deposit → mint** (sponsored, signed by your device) →
   **"Position is live ✅"** + SuiVision link.
4. **Voice works too** — send a voice note; it's transcribed (`gpt-4o-transcribe`) and handled the same.
5. Out of funds? **`/faucet`**. Prefer buttons? **`/market`** → one-tap **📈 UP $1 / 📉 DOWN $1**.
   Close a position: **`/redeem <strike> <up|down>`** (or let it settle — the keeper auto-redeems).

---

## Track minimum requirements

| Requirement | Status |
|---|---|
| **Integrate DeepBook Predict on testnet** | ✅ Full binary **and** range lifecycle via `predict-testnet-4-16` (see [Integration](#how-we-integrate-deepbook-predict)) |
| **Works end-to-end (full flow tested)** | ✅ Google → zkLogin → `create_manager` → `deposit` → `mint` → `redeem`, all sponsored, from chat/voice/buttons or the Mini App |
| **Simulation for vault strategies** | ➕ Live **PLP vault** (`supply`/`withdraw`) with on-chain evidence below |

---

## Deployed addresses (Sui testnet)

```
# DeepBook Predict (branch predict-testnet-4-16)
Predict package    0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
Predict registry   0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64
Predict object     0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
dUSDC quote type   0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
PLP share type     0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP
Indexer / API      https://predict-server.testnet.mystenlabs.com

# Our Move packages (testnet)
agent_policy       0xff1c1ded545bfa37541e79cf07656769ad0158b134baf0672994da3c5c881dc1
activity_log       0xb457f2a5841145d46136a3e951e891e9a4c723d41dea9eb3c2e7591d6353699f
tournament         0x049c59885e8371df494904054503939dfa7fba30dca1b5473d4e5f21e081194b
```

> ⚠️ dUSDC here is **not** the official testnet USDC. Get it via the track's
> [dUSDC form](https://tally.so/r/Xx102L) or the in-app `/faucet`.

---

## What's live on testnet (evidence)

| Capability | Evidence (tx) |
|---|---|
| Mint a position (create_manager → deposit → mint) | `2qd1nrJUHjh6f6NmMZWV2v7yaMuSYkxaMU38z9SnD5wb` |
| **Agent lifecycle** create_policy → agent trade → revoke → post-revoke abort | 6/6 — `9vyyp4sn…`, `AdSUUHuE…`, `B44ELLJ8…` |
| **PLP vault** supply 50 dUSDC → 49.89 PLP → withdraw | `3U7XBstd…`, `CEpeAZS5…` |
| **Tournament escrow** create → join → payout → double-payout abort | 4/4 — `HcCvwCHz…`, `6XCQdmVZ…`, `5yTuHrK2…` |

---

## How we integrate DeepBook Predict

A typed `PredictClient` (`packages/predict-sdk`) builds every PTB and reads all state.
Move calls used on `predict-testnet-4-16`:

- **Lifecycle:** `predict::create_manager` · `predict_manager::deposit` · `predict::mint` ·
  `predict::redeem` · `predict::redeem_permissionless`
- **Ranges:** `predict::mint_range` · `predict::redeem_range` · `range_key::new`
- **Pricing / reads:** `predict::get_trade_amounts` · `predict::get_range_trade_amounts` ·
  `predict_manager::balance` · `predict_manager::position` · `market_key::new`
- **PLP vault:** `predict::supply` · `predict::withdraw`

**Vol-surface aware.** Trades are priced against the live oracle and the protocol's
**ask bounds `[1%, 99%]`** are enforced *before* a trade is offered; the oracle picker
**skips near-expiry rounds** where every off-ATM strike pins to 1%/99% and would revert
(`EAskPriceOutOfBounds`). Post-trade aborts map to human messages.

**Self-custodial + sponsored.** The zkLogin ephemeral key is generated and held in the
browser (Mini App) — the backend never sees it. Gas is sponsored via **Enoki** behind a
strict, sender-scoped **move-call allow-list** (`apps/bot/src/api.ts`): only the Predict
lifecycle/vault calls above (plus key constructors and agent-policy calls) can be sponsored.

**AI agent.** `gpt-4o` with tool-calling (`get_market`, `preview_position`, `open_position`)
turns intent → a concrete `(strike, side, size)`; `gpt-4o-transcribe` handles voice.

---

## Architecture

```
        Telegram (text · voice · buttons)              Web: landing (/) · pitch (/pitch)
                     │                                              │
      ┌──────────────▼────────────────┐              ┌─────────────▼──────────────┐
      │  Bot (grammy, long-poll)       │              │  Mini App (Next.js 15)     │
      │  • AI agent gpt-4o + tools     │              │  • zkLogin sign-in         │
      │  • gpt-4o-transcribe (voice)   │              │  • onboard: create_manager │
      │  • /market /up /down /faucet   │              │  • trade: deposit→mint→    │
      │    /vault /redeem /streak …    │              │    redeem (signs w/ key)   │
      └──────┬──────────────┬──────────┘              └────────────┬───────────────┘
             │ HTTP API     │ Enoki sponsor (server key)           │ sponsored tx bytes
   ┌─────────▼──┐    ┌──────▼─────────────────────────────────────▼───────────────┐
   │ Postgres + │    │  DeepBook Predict (predict-testnet-4-16)  +  our Move pkgs   │
   │ Redis      │    │  create_manager · deposit · mint · redeem · ranges · PLP     │
   └────────────┘    └──────────────────────────────────────────────────────────────┘
   Keeper (apps/keeper): watches settled oracles → predict::redeem_permissionless
```

- **User trades are self-custodial** — backend holds only the Enoki sponsor key + public
  metadata (address, manager id, session pointers).
- **The agent never uses user keys** — it owns its own manager and an on-chain budget
  escrow it can't overspend and the user can `revoke`.

### Monorepo

```
packages/shared        constants · zod config · formatting · SVI math · vault/strategy math
packages/predict-sdk   DeepBook Predict reads + PTB builders   (@nanawise/predict-sdk)
packages/sui-auth      Enoki zkLogin + gas sponsorship + Redis sessions
packages/db            Prisma schema + client
apps/bot               grammy bot + AI agent + HTTP/sponsor API + workers (copy, settlement)
apps/keeper            settlement watcher / redeemer / agent loop / signal / copy-trade
apps/web               Next.js landing, Mini App (onboard/trade), pitch deck, dashboards
move/                  agent_policy · activity_log · tournament
```

---

## Run it

**Prereqs:** Node 20+, pnpm, Postgres, Redis, an HTTPS tunnel (Telegram Mini Apps need
HTTPS), and keys: **Enoki** (public+private), **Google OAuth** client, **OpenAI**. Testnet
dUSDC via the track form.

```bash
pnpm install
pnpm --filter @nanawise/db exec prisma migrate deploy

# Root .env  — TELEGRAM_BOT_TOKEN, ENOKI_PRIVATE_KEY, OPENAI_API_KEY, DATABASE_URL,
#   REDIS_URL, MINI_APP_URL=<tunnel→web:3000>, and the PREDICT_* / DUSDC_TYPE / PLP_TYPE ids above.
# apps/web/.env.local — NEXT_PUBLIC_ENOKI_PUBLIC_KEY, NEXT_PUBLIC_GOOGLE_CLIENT_ID,
#   NEXT_PUBLIC_OAUTH_REDIRECT_URI, NEXT_PUBLIC_API_BASE=<tunnel→api:8787>, NEXT_PUBLIC_PREDICT_*.

pnpm --filter web build && pnpm --filter web start    # Mini App + landing  :3000
pnpm --filter @nanawise/bot start                     # bot + sponsor API   :8787
pnpm --filter @nanawise/keeper start                  # (optional) auto-redeem keeper

pnpm test                                             # unit tests
npx tsc -p tsconfig.json --noEmit                     # typecheck
```

Point two tunnels at `:3000` (web) and `:8787` (API); set `MINI_APP_URL`,
`NEXT_PUBLIC_API_BASE`, and the Google redirect URI to the tunnel hosts.

---

## Notes for judges

- **Verified this build:** Google→zkLogin onboarding, on-chain `create_manager`,
  **sponsored `deposit`→`mint`→`redeem`** against the testnet Predict package, AI **text and
  voice** → priced position with one-tap pay, `/market` quick-trade, `/faucet` — exercised
  against the live oracle with correct ask-bounds / near-expiry handling.
- Agent, PLP vault, and tournament lifecycles are command-driven with the on-chain tx
  evidence listed above.
- Self-custodial by design; the only chain-specific surface is the `PREDICT_*` ids + indexer
  URL (all env-config), so **mainnet redeploy is a config swap**.

## License

MIT
