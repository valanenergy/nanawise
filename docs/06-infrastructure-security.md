# 06 — Infrastructure & Security

## Deployment topology

| Service | Platform | Notes |
|---|---|---|
| `apps/bot` | Railway (always-on) | Telegram webhook + WhatsApp webhook |
| `apps/keeper` | Railway (always-on) | Event watcher, redeemer, agent loop, crons |
| `apps/web` (Mini App + dashboard + auth callback) | Vercel | HTTPS required for Telegram Mini App + OAuth redirect |
| Postgres | Supabase free tier | Prisma migrations |
| Redis | Upstash free tier | Sessions, queues, caches |
| Sui testnet / predict-server / Enoki / Pyth | Mysten / providers | Public endpoints |

The keeper and bot are separate processes so a bot deploy never interrupts settlement, and so the agent loop has its own resource envelope.

## Environment variables

```
# Sui / Predict (from docs; testnet)
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SUI_NETWORK=testnet
PREDICT_PACKAGE_ID=0xf5ea...5138
PREDICT_REGISTRY_ID=0x43af...6e64
PREDICT_OBJECT_ID=0xc873...028a
PREDICT_SERVER_URL=https://predict-server.testnet.mystenlabs.com
DUSDC_TYPE=0xe950...::dusdc::DUSDC
CLOCK_ID=0x6

# Our Move packages (filled after Phase 4 deploy)
AGENT_POLICY_PACKAGE_ID=0x...
ACTIVITY_LOG_PACKAGE_ID=0x...

# Margin (Phases 6/8 — confirm branch/IDs first)
MARGIN_PACKAGE_ID=0x...
MARGIN_POOL_DUSDC_ID=0x...
PYTH_STATE_ID=0x...           # margin only

# Enoki
ENOKI_PUBLIC_KEY=enoki_public_...     # zkLogin address/ZKP (client where possible)
ENOKI_PRIVATE_KEY=enoki_private_...   # sponsorship — BACKEND ONLY, never shipped to client
NEXT_PUBLIC_ENOKI_PUBLIC_KEY=enoki_public_...

# Google OAuth (registered in Enoki Portal: client id + redirect URI)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET only if using server-side code exchange; prefer id_token implicit

# Telegram
TELEGRAM_BOT_TOKEN=...
MINIAPP_URL=https://web.nanawise.app/miniapp

# WhatsApp (Phase 8)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+1...

# Operational keypairs (backend only)
HOT_WALLET_PRIVATE_KEY=suiprivkey1...   # dUSDC funding faucet
KEEPER_PRIVATE_KEY=suiprivkey1...       # pays gas for redeem batches
AGENT_PRIVATE_KEY=suiprivkey1...        # the agent's keypair (owns agent manager)

# Infra
DATABASE_URL=postgresql://...
REDIS_URL=rediss://...

# Polymarket (signal)
POLYMARKET_API=https://gamma-api.polymarket.com/markets
```

## Secrets & key handling

| Key | Where it lives | Exposure rule |
|---|---|---|
| User ephemeral key | **User browser** (Mini App session storage) | Never sent to backend |
| Enoki **private** key (sponsor) | Backend env (bot + keeper) | Never bundled into `apps/web` client |
| Enoki **public** key | Client + backend | Public by design |
| Hot wallet key | Backend env | Backend only; low balance, monitored |
| Keeper key | Backend env | Backend only; holds SUI for gas only |
| Agent key | Backend env | Backend only; owns the agent manager |
| `GOOGLE_CLIENT_SECRET` | Backend only (if used) | Prefer implicit `id_token` to avoid it |

- `NEXT_PUBLIC_*` vars are the **only** values shipped to the browser. The Enoki private key, hot/keeper/agent keys, and DB/Redis URLs must never be `NEXT_PUBLIC_`. The Mini App must call a **backend `/api/sponsor` route** for the sponsor (private-key) step — the private key never appears in `apps/web`. Add a build-time check that `ENOKI_PRIVATE_KEY` is unreferenced in any client module.
- **Every Enoki call passes `network: "testnet"`.** Enoki endpoints default to **mainnet**; omitting `network` silently yields wrong addresses/proofs and sponsor failures. Make `network` a required, config-derived (`SUI_NETWORK`) argument in every `sui-auth` wrapper; unit-test that no Enoki call is built without it.
- **Per-phase sponsorship allowlist.** Configure `allowedMoveCallTargets` + `allowedAddresses` (in the request or the Portal) per phase, or sponsored txs are rejected / abusable:
  - Phase 1: `predict::create_manager`, the funding transfer / `predict_manager::deposit`; `allowedAddresses` = user zkLogin address (+ hot wallet for funding).
  - Phase 2: `predict::mint/redeem/mint_range/redeem_range`, `predict_manager::deposit`.
  - Phase 4: `agent_policy::*`, `activity_log::*` (agent trades are signed by the agent key — sponsorship optional there).
  - Phase 6: `predict::supply/withdraw`, and margin `supply/withdraw` if those are sponsored.
  - Phase 7: `tournament::*` (join/payout).

## Operational safety

- **Hot wallet monitor:** keeper checks dUSDC balance each cycle; alerts below a threshold (pre-fund ≥10,000 dUSDC; ~100 demo users × 100 dUSDC). Document the top-up procedure (faucet form).
- **Keeper SUI monitor:** alert when keeper SUI < N for gas.
- **Rate/own limits:** stay under Enoki free-tier sponsored-tx limits (verify in Portal — not publicly documented). Pre-fund headroom for judge testing.
- **Epoch guard:** before signing, verify `currentEpoch + buffer <= maxEpoch`; if not, prompt re-auth. Warn in the bot if a session has <30 min of epoch left during a demo.
- **PTB gas budget:** cap batch redeems at ≤20 calls/PTB; split larger settled sets across sequential PTBs.

## Threat notes (honest)

- **Client-held keys** remove the Redis-honeypot risk of the original design. If "fast mode" (server session keys) is ever enabled, that record must be encrypted at rest with a short TTL and is an explicit, opt-in custody tradeoff.
- **OAuth state / Mini App links** are single-use, short-TTL, unguessable, and bound to the Telegram user.
- **Agent compromise** is bounded by the escrow: even a fully compromised agent process can spend at most `budget_remaining`, and the user can revoke. This is the security payoff of the `04` design.
- **predict-server** is unauthenticated and unspecified; never trust it for authorization decisions, only for display, and validate every response.
