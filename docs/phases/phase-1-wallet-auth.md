# Phase 1 — Wallet & Auth (zkLogin + Enoki + Mini App onboarding)

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 1, §1 CC-4/CC-5) before building. Key corrections: persist the full signing artifact set for Phase 2; mandatory `network: "testnet"`; HMAC-verified single-use completion callback; fund the manager (not just the address).

**Goal:** A user runs `/start`, signs in with Google in the Telegram Mini App, and ends up with a Sui address, a `PredictManager`, and 100 dUSDC — gas sponsored, **ephemeral key held client-side**, real TX hashes visible.

**Depends on:** Phase 0 (config, `PredictClient`, `buildCreateManager`).

## Scope

**In:** `packages/sui-auth`, the Mini App onboarding page + OAuth callback, the bot `/start` flow, the dUSDC hot-wallet funding service, Postgres `User` record, Redis session pointer.

**Out:** trading commands (Phase 2), full dashboard (Phase 5).

## Corrected auth model (see `01 §2.2`, `02`)

- **Ephemeral key client-side** in the Mini App (session storage). Backend never holds it.
- **Enoki tiers:** use `EnokiClient` (private key) **server-side** for sponsorship; use the public key for address/ZKP (client-side where possible, else server proxy). Do **not** use the browser-only `registerEnokiWallets` for the bot.
- **Endpoints** (note `/v1` and the second execute call):
  - `GET /v1/zklogin` → `{ salt, address, publicKey }` (headers: `Authorization: Bearer <public>`, `zklogin-jwt: <jwt>`)
  - `POST /v1/zklogin/zkp` → `{ proofPoints, issBase64Details, headerBase64, addressSeed }` (body: `ephemeralPublicKey, maxEpoch, randomness, network`)
  - `POST /v1/transaction-blocks/sponsor` → `{ digest, bytes }` (body: `transactionBlockKindBytes, network, sender?, allowedAddresses?, allowedMoveCallTargets?`)
  - `POST /v1/transaction-blocks/sponsor/{digest}` → `{ digest }` (body: `signature`)
- **Nonce ordering:** generate ephemeral key → choose `maxEpoch = currentEpoch + 2` → randomness → **nonce**, embed nonce in the Google OAuth request (before sign-in). Validated correct.
- **Salt stability:** let Enoki own the salt; same Google account + same Enoki app (`aud`) → same address in bot/Mini App/dashboard. Do not cache or mint salt.

## Components

### `packages/sui-auth`
- `nonce.ts` — `buildNonce(ephPubkey, maxEpoch, randomness)`; helpers for `maxEpoch` from current epoch.
- `enoki.ts` — `getZkLogin(jwt)`, `getZkp({ ephPubkey, maxEpoch, randomness })` via the public key. (Callable from client; a thin server proxy is provided for environments that prefer not to expose even the public key.)
- `sponsor.ts` — `sponsorAndExecute({ txKindBytes, sender, userSignature })` using `EnokiClient` (private key): create sponsored tx → return bytes → caller obtains user signature → execute. Sets `allowedMoveCallTargets`/`allowedAddresses`.
- `session.ts` — Redis session **pointer** helpers (`{ suiAddress, managerId, maxEpoch, epochExpiryMs }`); `isExpired()`; `SET NX` create.

### Mini App onboarding (`apps/web/app/miniapp` + `(auth)`)
- `/(auth)/login` — minimal Google sign-in page (also used as the OAuth entry). Generates ephemeral key client-side, computes nonce, stores key in session storage, redirects to Google with the nonce.
- `/(auth)/callback` — receives `id_token`; calls Enoki for address + ZKP; posts `{ state_token }` completion to the backend; stores proof client-side.
- `miniapp/onboard` — orchestrates: ensure address; if no `PredictManager`, build `create_manager` PTB → sponsor → **user signs with client key** → execute; trigger hot-wallet funding; show success + TX links; signal the bot via backend.
- Telegram Web App SDK wiring: read `initData`, verify the Telegram user server-side, link `telegram_id ↔ suiAddress`.

### Bot `/start` (`apps/bot`)
- Session middleware (Redis): load `sess:{telegram_id}`.
- New user → reply with a **Web App button** opening `MINIAPP_URL?state=...`. Deep-link `state` stored in `oauth:{state}` (5-min TTL) bound to `telegram_id`.
- On backend completion callback → fetch oracle snapshot → send welcome message + quick-pick keyboard (read-only for now; trade buttons land in Phase 2).
- Returning, expired session → "tap to re-link Google" Web App button (non-silent re-auth).

### Hot-wallet funding (`apps/bot` or `apps/keeper`)
- **CORRECTION (found during the Phase 1 build):** `predict_manager::deposit` is **owner-gated** (`03 §5`: sender must be the manager owner), so the hot wallet **cannot** deposit into the user's manager. Corrected flow:
  1. `fundNewUserAddress(suiAddress)` — hot-wallet-signed tx transfers 100 dUSDC to the user's **address** (`transferObjects`).
  2. The user-signed (sponsored) onboarding PTB then runs `create_manager` and a **user-signed** `deposit` (sender = owner) so the 100 dUSDC lands in the manager's internal balance (which `mint` spends). create_manager + deposit are separate txs (you can't `&mut` a freshly-shared manager in the same PTB).
- Signing-lock to avoid gas-coin races (sandbox faucet pattern).
- **Idempotent:** guarded by `User.funded`/`fundedTxDigest` (`05`) + a Redis `funding_lock:{address}` NX key, checked under the signing lock so retries/double-onboarding never double-fund.
- Balance monitor + low-balance alert.

### Data
- Postgres `User` upsert `{ telegramId, suiAddress, managerId }`.
- Redis `oauth:{state}` and `sess:{telegram_id}` per `05`.

## Flow (happy path)
`/start` → bot sends Mini App button → user opens Mini App → Google sign-in (nonce embedded) → Enoki address+ZKP (client) → `create_manager` (sponsored, user-signed) → funding (sponsored hot-wallet send) → backend records user, marks session → bot welcome with address (truncated), balance, market summary, TX link.

## Acceptance criteria
- From a fresh Telegram account: `/start` → Google → within seconds a welcome showing a real Sui address, 100 dUSDC, and a `create_manager` TX link that resolves on the explorer.
- The ephemeral private key is provably **not** present in any backend log or store (session holds only public metadata).
- Gas is sponsored (user has 0 SUI and still transacts).
- Re-opening after `maxEpoch` expiry prompts re-auth rather than failing silently.
- The same Google account opened in the standalone dashboard (Phase 5) resolves to the **same** address/manager (salt stability) — verified once Phase 5 exists; for now assert address determinism across two Mini App logins.

## Test plan
- Unit: `buildNonce` determinism; `session.isExpired` epoch math; sponsor request body shape (allowlists present); funding idempotency.
- Integration: end-to-end onboarding against testnet with a throwaway Google account; assert manager created and 100 dUSDC received; assert no private key server-side.
- Negative: expired `oauth:{state}`; epoch-expiry mid-flow (mock) → graceful re-auth.

## Risks
| Risk | Mitigation |
|---|---|
| Enoki API/SDK drift from the documented surface | Pin `@mysten/enoki`; wrap all calls in `sui-auth`; integration test early |
| "Invalid client id" OAuth misconfig | Register Google client id + redirect URI in the Enoki Portal; document exact values |
| Telegram Mini App requires HTTPS + verified domain | Deploy `apps/web` to Vercel early; set `MINIAPP_URL` |
| Free-tier sponsorship limits unknown | Verify in Portal; pre-fund headroom; monitor usage |
| Epoch expiry mid-onboarding | `maxEpoch = current + 2`; pre-sign epoch check; retry path |
| Hot wallet runs dry | Monitor + alert; pre-fund ≥10,000 dUSDC |
