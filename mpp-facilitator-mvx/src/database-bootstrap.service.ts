import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type TableColumnInfo = {
  name: string;
};

@Injectable()
export class DatabaseBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    await this.ensureSessionTable();
    await this.ensureSettlementRecordTable();
    await this.ensureAuditReportTable();
    this.logger.log('SQLite schema bootstrapped');
  }

  private async ensureSessionTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Session" (
        "channelId" TEXT NOT NULL PRIMARY KEY,
        "employer" TEXT NOT NULL,
        "receiver" TEXT NOT NULL,
        "tokenId" TEXT NOT NULL,
        "amountLocked" TEXT NOT NULL,
        "amountSettled" TEXT NOT NULL DEFAULT '0',
        "lastVoucherAmount" TEXT NOT NULL DEFAULT '0',
        "lastVoucherNonce" BIGINT NOT NULL DEFAULT 0,
        "lastVoucherSignature" TEXT,
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME
      )
    `);

    await this.addColumnIfMissing(
      'Session',
      'lastVoucherSignature',
      '"lastVoucherSignature" TEXT',
    );
    await this.addColumnIfMissing('Session', 'updatedAt', '"updatedAt" DATETIME');
    await this.backfillUpdatedAt('Session');
  }

  private async ensureSettlementRecordTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SettlementRecord" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "txHash" TEXT NOT NULL DEFAULT '',
        "payer" TEXT,
        "receiver" TEXT,
        "amount" TEXT,
        "currency" TEXT,
        "chainId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME,
        "expiresAt" DATETIME,
        "opaque" TEXT,
        "digest" TEXT,
        "source" TEXT
      )
    `);

    await this.addColumnIfMissing('SettlementRecord', 'txHash', '"txHash" TEXT DEFAULT \'\'');
    await this.addColumnIfMissing('SettlementRecord', 'payer', '"payer" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'receiver', '"receiver" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'amount', '"amount" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'currency', '"currency" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'chainId', '"chainId" TEXT');
    await this.addColumnIfMissing(
      'SettlementRecord',
      'status',
      '"status" TEXT DEFAULT \'pending\'',
    );
    await this.addColumnIfMissing(
      'SettlementRecord',
      'createdAt',
      '"createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP',
    );
    await this.addColumnIfMissing(
      'SettlementRecord',
      'updatedAt',
      '"updatedAt" DATETIME',
    );
    await this.addColumnIfMissing(
      'SettlementRecord',
      'expiresAt',
      '"expiresAt" DATETIME',
    );
    await this.addColumnIfMissing('SettlementRecord', 'opaque', '"opaque" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'digest', '"digest" TEXT');
    await this.addColumnIfMissing('SettlementRecord', 'source', '"source" TEXT');
    await this.backfillUpdatedAt('SettlementRecord');
  }

  private async ensureAuditReportTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditReport" (
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
        "updatedAt" DATETIME
      )
    `);

    await this.addColumnIfMissing(
      'AuditReport',
      'paymentTxHash',
      '"paymentTxHash" TEXT',
    );
    await this.addColumnIfMissing('AuditReport', 'updatedAt', '"updatedAt" DATETIME');
    await this.backfillUpdatedAt('AuditReport');

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditReport_endpoint_generatedAt_idx"
      ON "AuditReport"("endpoint", "generatedAt")
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditReport_status_generatedAt_idx"
      ON "AuditReport"("status", "generatedAt")
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditReport_paymentTxHash_generatedAt_idx"
      ON "AuditReport"("paymentTxHash", "generatedAt")
    `);
  }

  private async addColumnIfMissing(
    tableName: string,
    columnName: string,
    columnSql: string,
  ): Promise<void> {
    const columns = await this.getColumnNames(tableName);
    if (columns.includes(columnName)) {
      return;
    }

    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" ADD COLUMN ${columnSql}`,
    );
  }

  private async backfillUpdatedAt(tableName: string): Promise<void> {
    const columns = await this.getColumnNames(tableName);
    if (!columns.includes('updatedAt')) {
      return;
    }

    await this.prisma.$executeRawUnsafe(`
      UPDATE "${tableName}"
      SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
      WHERE "updatedAt" IS NULL
    `);
  }

  private async getColumnNames(tableName: string): Promise<string[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `PRAGMA table_info("${tableName}")`,
    )) as TableColumnInfo[];

    return rows.map((row) => row.name);
  }
}
