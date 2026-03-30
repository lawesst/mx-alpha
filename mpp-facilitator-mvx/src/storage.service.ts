import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SettlementRecord } from '@prisma/client';
export type { SettlementRecord } from '@prisma/client';

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<SettlementRecord | null> {
    return this.prisma.settlementRecord.findUnique({ where: { id } });
  }

  async save(record: SettlementRecord): Promise<void> {
    await this.prisma.settlementRecord.upsert({
      where: { id: record.id },
      update: record,
      create: record,
    });
  }

  async updateStatus(
    id: string,
    status: string,
    txHash?: string,
  ): Promise<void> {
    await this.prisma.settlementRecord.update({
      where: { id },
      data: {
        status,
        ...(txHash ? { txHash } : {}),
      },
    });
  }

  async purgeExpired(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.settlementRecord.deleteMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now },
      },
    });
    return result.count;
  }

  async count(): Promise<number> {
    return this.prisma.settlementRecord.count();
  }
}
