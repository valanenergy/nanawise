# Nanawise

**Trade BTC up/down on DeepBook Predict from Telegram — no seed phrase, no gas, just Google sign-in.** A chat-first prediction-market app on Sui with self-custodial zkLogin wallets, a trustless on-chain agent that auto-trades within a budget you can revoke, a liquidity vault, and group tournaments with on-chain prize escrow.

> Built on **DeepBook Predict** (`predict-testnet-4-16`). Everything below is implemented and **validated live on Sui testnet** — real transaction hashes throughout.

## Track coverage

| Track | How Nanawise covers it |
|---|---|
| **DeepBook Predict** | Full binary + range lifecycle (mint/redeem/early-exit), the PLP liquidity vault (supply/withdraw), a keeper that auto-settles every position, and a live volatility-surface dashboard. SVI pricing matches the chain to **0.03pp** at-the-money. |
| **DeFi & Payments** | zkLogin onboarding (no keys, gas sponsored via Enoki), the PLP vault as a yield primitive, and **trustless tournament prize escrow** — a conditional payment that releases on-chain to the winner. |
| **Agentic Web** | An **on-chain agent wallet**: the agent owns its manager and trades within a Move **budget escrow** it can never overspend; the user can `revoke` and instantly reclaim unspent funds. Budget / expiry / identity / revocation are all enforced by the Move VM. |

## What's live on testnet

| Capability | Evidence |
|---|---|
| Mint a position (create_manager → deposit → mint) | `2qd1nrJUHjh6f6NmMZWV2v7yaMuSYkxaMU38z9SnD5wb` |
| **Agent lifecycle** create_policy → agent trade → revoke → post-revoke abort | 6/6 — `9vyyp4sn…`, `AdSUUHuE…`, `B44ELLJ8…` |
| **PLP vault** supply 50 dUSDC → 49.89 PLP → withdraw | `3U7XBstd…`, `CEpeAZS5…` |
| **Tournament escrow** create → join → payout → double-payout abort | 4/4 — `HcCvwCHz…`, `6XCQdmVZ…`, `5yTuHrK2…` |

Deployed Move packages (testnet): `agent_policy` `0xff1c1ded…`, `activity_log` `0xb457f2a5…`, `tournament` `0x5f2a437f…`.

## Architecture

```
Telegram bot (grammy) ─┐                      ┌─ DeepBook Predict (predict-testnet-4-16)
WhatsApp (Twilio)  ────┤   Mini App + Web     │  agent_policy + activity_log + tournament (ours)
                       ├─ (Next.js, zkLogin   ├─ Sui testnet
  backend (Node 20) ───┤   client-held key) ──┤
  bot · keeper · API   │                      └─ predict-server · Enoki (sponsor/ZKP) · Polymarket
  Redis · Postgres ────┘
```

- **User trades are self-custodial.** The zkLogin ephemeral key is generated and held **client-side** in the Mini App; the backend only holds the Enoki **sponsor** key and pays gas. See [`docs/02-architecture.md`](docs/02-architecture.md).
- **The agent never uses user keys** — it owns its own manager + an on-chain budget escrow ([`docs/04-agent-wallet-design.md`](docs/04-agent-wallet-design.md)).

## Monorepo

```
packages/shared        constants · zod config · formatting · SVI N(d2) · vault · strategies math
packages/predict-sdk   server reads + on-chain reads + PTB builders   (published: @nanawise/predict-sdk)
packages/sui-auth      Enoki zkLogin + gas sponsorship + Redis sessions
packages/db            Prisma schema + client
apps/bot               grammy bot + HTTP API (sponsor proxy, onboard, WhatsApp) + workers
apps/keeper            settlement watcher/redeemer/notifier + agent loop + signal + copy-trade
apps/web               Next.js Mini App + dashboard (market, surface, portfolio, vault, ranks, agent)
move/                  agent_policy · activity_log · tournament  (20 Move tests)
scripts/               spike-mint · new-key · load-test
docs/                  architecture, validated protocol reference, per-phase specs, build progress
```

## Setup

```bash
pnpm install
cp .env.example .env            # fill in keys (see docs/06-infrastructure-security.md)

# local infra
docker compose -f infra/docker-compose.yml up -d      # or brew services: redis + postgresql@16
pnpm --filter @nanawise/db exec prisma migrate dev

pnpm test                       # 47 unit tests
npx tsc -p tsconfig.json --noEmit   # typecheck
( cd move/agent_policy && sui move test )             # Move tests (×3 packages)

# run
pnpm --filter @nanawise/bot start       # bot + HTTP API (:8787)
pnpm --filter @nanawise/keeper start    # settlement + agent + signal
pnpm --filter @nanawise/web dev         # Mini App + dashboard (:3000)

# prove the protocol integration end-to-end
pnpm spike                              # create_manager → deposit → mint → read back (testnet)
```

The Telegram Mini App needs a public HTTPS URL (Web App buttons won't open `localhost`) — use a tunnel (`cloudflared`/`ngrok`) or deploy `apps/web` to Vercel and set `MINI_APP_URL`. Outstanding runtime prerequisites are tracked in [`docs/BLOCKERS.md`](docs/BLOCKERS.md).

## 5-minute demo script

1. **Onboard (zero-crypto)** — `/start` in Telegram → Google sign-in → wallet + `PredictManager` created (sponsored TX), funded 100 dUSDC. *No seed phrase, no gas.*
2. **First trade** — `/market` → `/up 62000 10` → confirm in the Mini App → real mint TX.
3. **Settlement** — when the oracle settles, the keeper auto-redeems and DMs the payout (`✅ WON … added to your balance`).
4. **Dashboard** — open the web app: live volatility surface, portfolio PnL, vault stats.
5. **Agent** — `/policy 50 24` (fund a budget escrow) → `/auto vol-harvest` → watch it trade across rounds → `/revoke` returns unspent funds on-chain. *The agent provably can't overspend or trade after revoke.*

Fallbacks for testnet/oracle flakiness during judging: captured settlement DM, a recorded agent run, and the video — see [`docs/08-build-progress.md`](docs/08-build-progress.md).

## SDK

`@nanawise/predict-sdk` is publish-ready (clean ESM/CJS + types, README with a 10-line mint example): [`packages/predict-sdk/README.md`](packages/predict-sdk/README.md).

## License

MIT
