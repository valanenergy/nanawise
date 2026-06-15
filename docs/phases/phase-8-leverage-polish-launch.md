# Phase 8 — Agent Leverage Demo + Polish + WhatsApp + SDK Release + Demo

> **Reviewed & corrected.** Gap-audited — see [`../07-review-findings-and-resolutions.md`](../07-review-findings-and-resolutions.md) (§2 Phase 8) before building. Key corrections: margin-leverage Day-1 go/no-go spike (signatures + IDs); WhatsApp tokenized web-signing path (no Mini App); leverage event-schema fit; `keeper-lib` extraction scope; numeric load-test thresholds.

**Goal:** Land the high-wow agent-leverage demo slice, port to WhatsApp, harden every error path, publish the SDK, and make the product cold-start usable by a judge with a rehearsed 5-minute demo.

**Depends on:** all prior phases.

## Scope

**In:** the bounded agent leverage demo (DeepBook Margin), WhatsApp (Twilio), onboarding/error polish, load test, `@nanawise/predict-sdk` + `@nanawise/keeper` npm publish, README/architecture docs, demo script + video.

**Out:** anything requiring protocol changes; production hardening beyond the demo envelope.

## Part A — Agent leverage demo (Margin)

### Validated facts (`01 §4`, `04`)
- DeepBook Margin: `MarginManager<Base,Quote>` for leveraged spot, `borrow_*`/`repay_*`, risk-ratio (Pyth-valued, 5-min max age, 5% tolerance), permissionless liquidation, on-chain TP/SL (`tpsl.move`). 1–20x; we cap at **≤2x**.

### Components
- Agent opens its **own** `MarginManager` on a real DeepBook spot pool (e.g. SUI/USDC), funds from the escrow via `request_funds` (`04`), borrows to ≤2x, sets an on-chain stop-loss (`tpsl`), and logs `action_type = 4 (leverage)`.
- Pyth price wiring (read `PriceInfoObject`, freshness check) — the main lift.
- Strictly **one** demo position, conservative size; documented as a demo slice, not a core product loop.

### Acceptance
- The agent executes one ≤2x leveraged spot trade with an on-chain stop-loss, funded from the on-chain budget escrow, logged on-chain — within a fresh-Pyth window. If Pyth/pool prerequisites can't be met on testnet, this is cut to "future work" in the demo (logged), not faked.

## Part B — WhatsApp (Twilio)
- Webhook handler in `apps/bot/src/webhooks`; platform-detection routes to a plain-text formatter (numbered menus instead of inline keyboards; links instead of photo cards; web link instead of Mini App where Web App buttons aren't available).
- All commands behave identically; only formatting/interaction differs.
- Twilio sandbox for immediate testing; Meta approval is best-effort (apply early; 3–7 business days).

## Part C — Polish
- Onboarding: a tight 3-step welcome + "how it works" inline flow.
- Error UX: confirm every failure mode from `03 §6` + auth/epoch/sponsor/limiter cases shows a human message; no stack traces reach users.
- Re-auth UX: the "tap to re-link Google" path is smooth (sessions expire ~1–2 days).
- Load test: 20 concurrent `/start` + trades; assert no session collisions (`SET NX`), no double-onboarding, sponsor/hot-wallet headroom holds.

## Part D — SDK release
- `@nanawise/predict-sdk` — clean public API (`03 §8`), TS types, README with examples (mint a position directly), versioned.
- `@nanawise/keeper` — standalone settlement keeper package (`PredictKeeper({ rpc, predictObjectId, keeperKey, onSettlement })`), README.
- Publish to npm; verify a fresh `npm install` + a 10-line mint example works.

## Part E — Demo & docs
- README: setup, architecture diagram, track-coverage table.
- 5-minute demo script (rehearsed): onboarding (zero-crypto) → first trade (real TX) → settlement DM (keeper) → dashboard vol surface + vault → agent policy + `/revoke` (on-chain). 3-minute video walkthrough as the submission artifact.
- Fallbacks documented: captured settlement DM, captured agent run, recorded video — in case of testnet/oracle flakiness during judging.

## Acceptance criteria
- A cold judge completes the full flow unaided on testnet with real TX hashes at each step.
- WhatsApp sandbox runs the core commands.
- Both npm packages install and run from a clean project.
- The demo script runs in ≤5 minutes; the video is recorded; fallbacks are ready.

## Test plan
- Integration: full judge flow on a fresh account; WhatsApp sandbox parity for `/start`,`/market`,`/up`,`/pnl`.
- Release: clean-room `npm install` + example for both packages.
- Resilience: load test results recorded; chaos (kill keeper/bot mid-flow) → graceful recovery.

## Risks
| Risk | Mitigation |
|---|---|
| Pyth/margin prerequisites unmet on testnet | Cut leverage demo to "future work" (logged), keep core demo intact |
| Meta WhatsApp approval delay | Twilio sandbox demo; Meta best-effort |
| Testnet/oracle flakiness during judging | Captured fallbacks (DM, agent run, video) |
| npm publish/scope issues | Reserve the `@nanawise` scope early; dry-run `npm pack` |
| Last-mile error leaks | Centralized error formatter; exhaustive failure-mode checklist |
