-- CreateIndex
CREATE INDEX "AuditReport_paymentTxHash_generatedAt_idx" ON "AuditReport"("paymentTxHash", "generatedAt");
