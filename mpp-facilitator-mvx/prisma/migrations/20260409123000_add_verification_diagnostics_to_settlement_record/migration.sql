ALTER TABLE "SettlementRecord"
ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SettlementRecord"
ADD COLUMN "lastVerificationAt" DATETIME;

ALTER TABLE "SettlementRecord"
ADD COLUMN "lastVerificationStatus" TEXT;

ALTER TABLE "SettlementRecord"
ADD COLUMN "lastVerificationError" TEXT;

ALTER TABLE "SettlementRecord"
ADD COLUMN "lastObservedTxStatus" TEXT;

ALTER TABLE "SettlementRecord"
ADD COLUMN "lastVerificationTxHash" TEXT;
