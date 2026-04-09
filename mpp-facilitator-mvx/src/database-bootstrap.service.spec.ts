import { DatabaseBootstrapService } from './database-bootstrap.service';

describe('DatabaseBootstrapService', () => {
  let service: DatabaseBootstrapService;
  let prisma: {
    $executeRawUnsafe: jest.Mock;
    $queryRawUnsafe: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn(),
    };
    service = new DatabaseBootstrapService(prisma as any);
  });

  it('creates the required tables and indexes for a fresh sqlite database', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    await service.ensureSchema();

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "Session"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "SettlementRecord"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "AuditReport"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE INDEX IF NOT EXISTS "AuditReport_paymentTxHash_generatedAt_idx"',
      ),
    );
  });

  it('adds missing drifted columns for sqlite tables', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { name: 'channelId' },
      { name: 'id' },
      { name: 'createdAt' },
    ]);

    await service.ensureSchema();

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "Session" ADD COLUMN "lastVoucherSignature" TEXT',
      ),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "SettlementRecord" ADD COLUMN "updatedAt" DATETIME',
      ),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "AuditReport" ADD COLUMN "paymentTxHash" TEXT',
      ),
    );
  });
});
