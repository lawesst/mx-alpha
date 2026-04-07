-- CreateTable
CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schemaVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "sender" TEXT NOT NULL,
    "facilitatorBaseUrl" TEXT NOT NULL,
    "receipt" TEXT,
    "paymentTxHash" TEXT,
    "errorKinds" TEXT NOT NULL DEFAULT '[]',
    "requestJson" TEXT NOT NULL,
    "executionPolicyJson" TEXT,
    "resultJson" TEXT NOT NULL,
    "reportJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AuditReport_endpoint_generatedAt_idx" ON "AuditReport"("endpoint", "generatedAt");

-- CreateIndex
CREATE INDEX "AuditReport_status_generatedAt_idx" ON "AuditReport"("status", "generatedAt");
