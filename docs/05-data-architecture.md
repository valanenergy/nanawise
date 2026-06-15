# 05 — Data Architecture

## Principle

The chain and the predict-server are the source of truth for anything financial. Our own stores (Redis, Postgres) hold only: session state, queues, caches, social/gamification data, and a mirror of on-chain agent events for fast pagination. We never treat our DB as authoritative for balances or positions.

## On-chain vs. off-chain decisions

| Data | Source | Why |
|---|---|---|
| BTC spot / forward | predict-server `/oracles/:id/state` | Indexed, low-latency |
| SVI params (history) | predict-server `/oracles/:id/svi` | History from server |
| SVI params (live) | Sui event `OracleSVIUpdated` | Lowest-latency updates |
| User positions / balance | predict-server `/managers/:id/...` | Already indexed; faster than chain scan |
| Settlement result | Sui event `OracleSettled` | Keeper must catch it first |
| Agent policy state | Direct chain read (`getObject`) | Must be authoritative for any constraint UI |
| Agent activity feed | Sui event `ActionExecuted` → Postgres | Live from events; paginate from DB |
| Vault utilization / perf | predict-server `/vault/...` | Pre-aggregated |
| PLP balance | predict-server (display) + chain read (flows) | Server for UI, chain for tx building |
| Margin lending position | chain read + margin pool state | Authoritative |
| Sessions | Redis (client-held key metadata only) | Ephemeral |
| Streaks / groups / tournaments | Postgres | Needs persistence, not speed |
| Group leaderboard (hot) | Redis sorted set + Postgres | Fast reads + durability |
| Signal (Polymarket vs ours) | Redis cache | Cheap, short-lived |

## Redis

> With client-held keys (Mini App), Redis stores **session metadata and OAuth state**, not the ephemeral private key. The private key lives in the user's browser session storage. (If the optional "fast mode" server key is ever enabled, that record is encrypted at rest and TTL'd to `maxEpoch` — see `06`.)

| Key | Value | TTL | Purpose |
|---|---|---|---|
| `oauth:{state}` | `{ ephemeralPublicKey, nonce, maxEpoch, randomness, telegram_id }` | 5 min | Pre-login OAuth state (public key only) |
| `sess:{telegram_id}` | `{ suiAddress, managerId, maxEpoch, epochExpiryMs }` | until `maxEpoch` | Session pointer (no private key) |
| `signal:latest` | `{ ours, polymarket, spread, strike, updatedAt }` | 6 min | `/signal` cache |
| `grp:{chat_id}:lb` | sorted set `member→pnl` | resets midnight UTC | Group leaderboard |
| `oracle:active` | `{ oracleId, expiry, spot, timestamp }` | 30 s | Hot oracle snapshot for fast command replies |
| Bull `settlement-notifications` | `{ telegram_id, result, payout, strike, direction }` | until processed | Settlement DM jobs |
| Bull `copy-trade` | `{ follower_id, targetId, oracle, expiry, strike, isUp, sizing:{fraction?\|fixedAmount?}, mode }` | until processed | Copy-trade jobs (`expiry` needed for `MarketKey`; `mode` = `confirm`\|`agent`) |

Atomicity: use `SET NX` when first writing a session to prevent double-onboarding races.

## Postgres (Prisma)

```prisma
model User {
  id          String   @id @default(uuid())
  telegramId  BigInt   @unique
  whatsappId  String?  @unique
  suiAddress  String
  managerId   String?
  agentPolicyId String?
  refByUserId String?
  funded        Boolean @default(false)   // hot-wallet onboarding grant sent (idempotency)
  fundedTxDigest String?
  createdAt   DateTime @default(now())
  streak      Streak?
  copyFollows CopyTrade[] @relation("follower")
  copyTargets CopyTrade[] @relation("target")
}

model Streak {
  userId        String  @id
  user          User    @relation(fields:[userId], references:[id])
  current       Int     @default(0)
  longest       Int     @default(0)
  lastWinDate   DateTime?
  totalTrades   Int     @default(0)
  totalWins     Int     @default(0)
}

model Group {
  chatId    BigInt   @id
  name      String?
  createdAt DateTime @default(now())
  tournaments Tournament[]
}

model Tournament {
  id          String   @id @default(uuid())
  group       Group    @relation(fields:[groupChatId], references:[chatId])
  groupChatId BigInt
  status      String   // active | settled | cancelled
  entryFee    BigInt   // dUSDC base units
  prizePool   BigInt   // = entryFee × participants − platformFee; accrues on each join
  escrowObjectId String // custom `tournament` Move escrow object (Balance<DUSDC>) — NOT a PredictManager (deposit is owner-gated)
  startTime   DateTime
  endTime     DateTime
  winnerUserId String?
  createdAt   DateTime @default(now())
}

model CopyTrade {
  followerId  String
  targetId    String
  follower    User @relation("follower", fields:[followerId], references:[id])
  target      User @relation("target",   fields:[targetId],   references:[id])
  fraction    Decimal? @db.Decimal(4,2)  // 0.5 = 50% size
  fixedAmount BigInt?                     // alternative fixed dUSDC amount
  active      Boolean  @default(true)
  consent     Boolean  @default(false)    // target opted in to being copied
  @@id([followerId, targetId])
}

// Mirror of on-chain ActionExecuted events for fast pagination
model AgentAction {
  id              String   @id @default(uuid())
  policyId        String
  ownerAddress    String
  strategy        String
  actionType      String   // mint | redeem | mint_range | return_funds | leverage
  oracleId        String
  strike          BigInt?
  isUp            Boolean?
  quantity        BigInt?
  amountSpent     BigInt?
  budgetRemaining BigInt?
  txHash          String
  createdAt       DateTime @default(now())
  @@index([policyId])
  @@index([ownerAddress])
}

// Keeper settlement ledger — idempotency for redeem batches + DM/streak source.
// Payout/cost are read directly from PositionRedeemed/RangeRedeemed events (verified).
model Redemption {
  id            String   @id @default(uuid())
  managerId     String
  ownerAddress  String
  oracleId      String
  isRange       Boolean  @default(false)
  strike        BigInt?          // binary
  direction     Int?             // 0 up / 1 down (binary)
  lowerStrike   BigInt?          // range
  higherStrike  BigInt?          // range
  quantity      BigInt
  payout        BigInt           // from the redeem event
  settledPrice  BigInt?
  txHash        String
  createdAt     DateTime @default(now())
  @@unique([managerId, oracleId, strike, direction, lowerStrike, higherStrike, isRange]) // dedup guard
  @@index([managerId])
}
```

## Indexing / consistency rules

- After any write tx, `waitForTransaction(digest)` before reading the dependent object/server record.
- The keeper is the single writer of `Streak`, `AgentAction`, and tournament settlement — avoids cross-service races.
- predict-server responses are validated with zod at the SDK boundary; a schema mismatch logs and falls back to a chain read where feasible (the API has no documented schema, so we must be defensive).
- Leaderboard truth is on-chain settlement events; Redis is a cache rebuilt from Postgres on restart.
