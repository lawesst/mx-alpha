-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txHash" TEXT NOT NULL DEFAULT '',
    "payer" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "opaque" TEXT,
    "digest" TEXT,
    "source" TEXT
);
