-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "whatsappId" TEXT,
    "suiAddress" TEXT NOT NULL,
    "managerId" TEXT,
    "agentPolicyId" TEXT,
    "refByUserId" TEXT,
    "funded" BOOLEAN NOT NULL DEFAULT false,
    "fundedTxDigest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streak" (
    "userId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "lastWinDate" TIMESTAMP(3),
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Group" (
    "chatId" BIGINT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "groupChatId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "entryFee" BIGINT NOT NULL,
    "prizePool" BIGINT NOT NULL,
    "escrowObjectId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "winnerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTrade" (
    "followerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "fraction" DECIMAL(4,2),
    "fixedAmount" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CopyTrade_pkey" PRIMARY KEY ("followerId","targetId")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "oracleId" TEXT NOT NULL,
    "strike" BIGINT,
    "isUp" BOOLEAN,
    "quantity" BIGINT,
    "amountSpent" BIGINT,
    "budgetRemaining" BIGINT,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "oracleId" TEXT NOT NULL,
    "isRange" BOOLEAN NOT NULL DEFAULT false,
    "strike" BIGINT,
    "direction" INTEGER,
    "lowerStrike" BIGINT,
    "higherStrike" BIGINT,
    "quantity" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL,
    "settledPrice" BIGINT,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappId_key" ON "User"("whatsappId");

-- CreateIndex
CREATE INDEX "AgentAction_policyId_idx" ON "AgentAction"("policyId");

-- CreateIndex
CREATE INDEX "AgentAction_ownerAddress_idx" ON "AgentAction"("ownerAddress");

-- CreateIndex
CREATE INDEX "Redemption_managerId_idx" ON "Redemption"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_managerId_oracleId_strike_direction_lowerStrike__key" ON "Redemption"("managerId", "oracleId", "strike", "direction", "lowerStrike", "higherStrike", "isRange");

-- AddForeignKey
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_groupChatId_fkey" FOREIGN KEY ("groupChatId") REFERENCES "Group"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
