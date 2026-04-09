import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, SettlementRecord } from '@prisma/client';
export type { SettlementRecord } from '@prisma/client';

export type SettlementVerificationDiagnostics = {
  attemptedTxHash?: string;
  observedTxStatus?: string;
  verificationStatus: string;
  verificationError?: string | null;
  verifiedAt?: Date;
};

export type SettlementRecordSaveInput = Pick<SettlementRecord, 'id'> &
  Partial<SettlementRecord>;

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<SettlementRecord | null> {
    return this.prisma.settlementRecord.findUnique({ where: { id } });
  }

  async save(record: SettlementRecordSaveInput): Promise<void> {
    const createData: Prisma.SettlementRecordUncheckedCreateInput = {
      txHash: '',
      payer: '',
      receiver: '',
      amount: '0',
      currency: 'EGLD',
      chainId: 'D',
      status: 'pending',
      expiresAt: null,
      opaque: null,
      digest: null,
      source: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      verificationAttempts: 0,
      lastVerificationAt: null,
      lastVerificationStatus: null,
      lastVerificationError: null,
      lastObservedTxStatus: null,
      lastVerificationTxHash: null,
      ...record,
    };
    const updateData = this.toUpdateInput(record);

    await this.prisma.settlementRecord.upsert({
      where: { id: createData.id },
      update: updateData,
      create: createData,
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

  async recordVerificationAttempt(
    id: string,
    diagnostics: SettlementVerificationDiagnostics,
  ): Promise<void> {
    await this.prisma.settlementRecord.update({
      where: { id },
      data: {
        verificationAttempts: {
          increment: 1,
        },
        lastVerificationAt: diagnostics.verifiedAt ?? new Date(),
        lastVerificationStatus: diagnostics.verificationStatus,
        lastVerificationError: diagnostics.verificationError ?? null,
        lastObservedTxStatus: diagnostics.observedTxStatus ?? null,
        lastVerificationTxHash: diagnostics.attemptedTxHash ?? null,
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

  private toUpdateInput(
    record: SettlementRecordSaveInput,
  ): Prisma.SettlementRecordUncheckedUpdateInput {
    return Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    ) as Prisma.SettlementRecordUncheckedUpdateInput;
  }
}
