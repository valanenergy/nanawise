# 00 — Product Overview

## What Nanawise is

Nanawise is a consumer trading product on **DeepBook Predict**, the on-chain binary-options / prediction-market primitive on Sui (live on testnet, branch `predict-testnet-4-16`). It removes every Web3 barrier between an ordinary user and an institutional-quality options market: no seed phrase, no wallet app to install, no gas to buy.

A user opens Telegram, signs in with Google, and within seconds has a Sui wallet, 100 dUSDC of test balance, and a one-tap binary position. Behind that interface sits real DeFi: Block Scholes SVI volatility surfaces pricing every strike, a shared vault (PLP) taking the other side of every trade, sub-hour BTC expiries settling on-chain, and an autonomous trading agent constrained by an **on-chain budget escrow** the user can revoke at any time.

## Target hackathon tracks (Sui Overflow 2026)

Nanawise is built to hit three tracks with one product:

1. **DeepBook Predict** — a complete consumer integration of `mint`/`redeem`/`supply`/`mint_range`/`redeem_permissionless`, using the predict-server API, implementing the documented "Telegram bot" idea and extending it.
2. **DeFi & Payments** — programmable money flows via PTBs (atomic onboarding), a smart agent wallet with automation, conditional payments (tournament escrow), an on-chain yield source (Margin lending), and a consumer financial product.
3. **Agentic Web (Sub-track 2)** — an autonomous agent that places real DeepBook Predict trades, with a **self-enforced budget ceiling in the Move VM**, an **on-chain activity log**, and **demonstrable owner revocation**.

## The four decisions that shaped this plan

These were confirmed with the user after the validity audit (see [`01-validity-and-decisions.md`](./01-validity-and-decisions.md)):

1. **Agent architecture → agent-owned manager + on-chain budget escrow.** The protocol forbids a third-party keypair from trading on a user's manager, so the agent gets its own `PredictManager` and pulls budget per-trade from a user-funded `AgentPolicy` escrow that enforces the cap and revocation inside Move. Real protocol-level enforcement. Detailed in [`04-agent-wallet-design.md`](./04-agent-wallet-design.md).
2. **Margin scope → dUSDC lending yield + a bounded agent-leverage demo.** Idle balances earn on-chain yield via a DeepBook Margin `MarginPool<DUSDC>`; the agent additionally performs one bounded (≤2x) leveraged spot trade with on-chain stop-loss as a demo slice.
3. **UX surface → hybrid chat-first bot + Telegram Mini App.** Chat for speed; a Mini App for onboarding, signing, charts, vault, and the agent dashboard. The Mini App holds the ephemeral key client-side, making user trades genuinely self-custodial.
4. **Docs format → phase-based vertical slices** (this folder).

## Scope boundaries (what we are NOT building)

- **No margin-on-Predict and no borrowing-against-PLP.** Both are novel, oracle-blocked, and fragile in a hackathon window (see `01`). Future work only.
- **No custom indexer.** We rely on the predict-server API for indexed reads and the Sui event stream for live updates.
- **No mainnet deployment.** Testnet only; all IDs config-driven so a mainnet redeploy is a config change.
- **No ML price prediction.** The agent runs systematic, volatility-surface-driven strategies — not directional AI forecasts.

## Primary users

| Persona | Need | Primary surface |
|---|---|---|
| Riya — curious non-crypto user | One-tap UP/DOWN, plain-language results, shareable PnL | Telegram chat + Mini App |
| Arjun — active trader | Strike table, raw positions, fast execution, agent strategies, signal | Chat + Mini App + dashboard |
| Priya — liquidity provider | Vault risk metrics, supply/withdraw, yield | Web dashboard + `/vault` |
| Dev — judge / builder | Verifiable on-chain TXs, agent policy object, revocation, reusable SDK | Explorer + dashboard + npm SDK |

## Success definition

The product is "done" when a cold judge can, unaided: `/start` → Google → funded wallet (real TX) → place a trade (real TX) → see it settle via the keeper (DM) → browse the dashboard's vol surface and vault → create an agent policy, watch it trade, and `/revoke` it (real on-chain state change) — all on Sui testnet, with the SDK published to npm.
