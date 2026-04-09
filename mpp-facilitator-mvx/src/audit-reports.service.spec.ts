import { BadRequestException } from '@nestjs/common';
import { AuditReport } from '@prisma/client';
import { AuditReportsService } from './audit-reports.service';

describe('AuditReportsService', () => {
  let service: AuditReportsService;
  let prisma: {
    auditReport: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      auditReport: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new AuditReportsService(prisma as any);
  });

  it('ingests a valid paid intel audit report and returns a stored summary', async () => {
    const storedRecord = makeAuditReportRecord({
      endpoint: 'swap-plan',
      status: 'success',
      generatedAt: new Date('2026-04-07T08:00:00.000Z'),
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt-123',
      paymentTxHash: 'tx-hash-123',
      errorKinds: '[]',
      reportJson: JSON.stringify({
        schemaVersion: 1,
        kind: 'paid-intel-audit-report',
        status: 'success',
        generatedAt: '2026-04-07T08:00:00.000Z',
        endpoint: 'swap-plan',
        request: {
          kind: 'swap-plan',
          from: 'EGLD',
          to: 'RIDE-7d18e9',
          amount: '1.25',
        },
        payment: {
          sender: 'erd1sender',
          facilitatorBaseUrl: 'http://localhost:3000',
          receipt: 'receipt-123',
          paymentTxHash: 'tx-hash-123',
        },
        executionPolicy: {
          maxActionCount: 4,
        },
        result: {
          endpoint: 'swap-plan',
          execution: {
            executions: [],
          },
        },
      }),
    });

    prisma.auditReport.create.mockResolvedValue(storedRecord);
    prisma.auditReport.findUnique.mockResolvedValue(storedRecord);

    const stored = await service.ingestReport({
      schemaVersion: 1,
      kind: 'paid-intel-audit-report',
      status: 'success',
      generatedAt: '2026-04-07T08:00:00.000Z',
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
        from: 'EGLD',
        to: 'RIDE-7d18e9',
        amount: '1.25',
      },
      payment: {
        sender: 'erd1sender',
        facilitatorBaseUrl: 'http://localhost:3000',
        receipt: 'receipt-123',
        paymentTxHash: 'tx-hash-123',
      },
      executionPolicy: {
        maxActionCount: 4,
      },
      result: {
        endpoint: 'swap-plan',
        execution: {
          executions: [],
        },
      },
    });

    expect(prisma.auditReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpoint: 'swap-plan',
          status: 'success',
          sender: 'erd1sender',
          paymentTxHash: 'tx-hash-123',
        }),
      }),
    );
    expect(stored).toEqual(
      expect.objectContaining({
        id: storedRecord.id,
        endpoint: 'swap-plan',
        status: 'success',
        paymentTxHash: 'tx-hash-123',
        hasReceipt: true,
        errorKinds: [],
      }),
    );

    const detail = await service.getReport(stored.id);
    expect(detail.report.payment.sender).toBe('erd1sender');
    expect(detail.report.executionPolicy).toEqual({ maxActionCount: 4 });
  });

  it('rejects audit reports with invalid payment metadata', async () => {
    await expect(
      service.ingestReport({
        schemaVersion: 1,
        kind: 'paid-intel-audit-report',
        status: 'success',
        generatedAt: '2026-04-07T08:00:00.000Z',
        endpoint: 'wallet-profile',
        request: {
          kind: 'wallet-profile',
        },
        payment: {
          sender: '',
          facilitatorBaseUrl: 'http://localhost:3000',
          receipt: null,
          paymentTxHash: null,
        },
        result: {
          endpoint: 'wallet-profile',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists stored reports newest first and applies endpoint and status filters', async () => {
    prisma.auditReport.findMany.mockResolvedValue([
      makeAuditReportRecord({
        endpoint: 'swap-plan',
        status: 'error',
        generatedAt: new Date('2026-04-07T09:00:00.000Z'),
        sender: 'erd1sender',
        facilitatorBaseUrl: 'http://localhost:3000',
        receipt: null,
        paymentTxHash: 'tx-2',
        errorKinds: '["executionError"]',
      }),
    ]);

    const list = await service.listReports({
      endpoint: 'swap-plan',
      status: 'error',
      limit: 10,
    });

    expect(prisma.auditReport.findMany).toHaveBeenCalledWith({
      where: {
        endpoint: 'swap-plan',
        status: 'error',
      },
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    });
    expect(list.count).toBe(1);
    expect(list.filters).toEqual({
      endpoint: 'swap-plan',
      status: 'error',
      limit: 10,
    });
    expect(list.reports[0]).toEqual(
      expect.objectContaining({
        endpoint: 'swap-plan',
        status: 'error',
        paymentTxHash: 'tx-2',
        errorKinds: ['executionError'],
      }),
    );
  });

  it('builds endpoint summaries with latest success, latest error, and error kinds', async () => {
    prisma.auditReport.findMany.mockResolvedValue([
      makeAuditReportRecord({
        endpoint: 'wallet-profile',
        status: 'success',
        generatedAt: new Date('2026-04-07T10:00:00.000Z'),
        sender: 'erd1sender',
        facilitatorBaseUrl: 'http://localhost:3000',
        receipt: 'receipt-3',
        paymentTxHash: 'tx-3',
        errorKinds: '[]',
      }),
      makeAuditReportRecord({
        endpoint: 'swap-plan',
        status: 'error',
        generatedAt: new Date('2026-04-07T09:00:00.000Z'),
        sender: 'erd1sender',
        facilitatorBaseUrl: 'http://localhost:3000',
        receipt: null,
        paymentTxHash: 'tx-2',
        errorKinds: '["simulationError","executionError"]',
      }),
      makeAuditReportRecord({
        endpoint: 'swap-plan',
        status: 'success',
        generatedAt: new Date('2026-04-07T08:00:00.000Z'),
        sender: 'erd1sender',
        facilitatorBaseUrl: 'http://localhost:3000',
        receipt: 'receipt-1',
        paymentTxHash: 'tx-1',
        errorKinds: '[]',
      }),
    ]);

    const summary = await service.getSummary({});

    expect(summary.totals).toEqual({
      reports: 3,
      success: 2,
      error: 1,
    });
    expect(summary.endpoints).toEqual([
      {
        endpoint: 'swap-plan',
        total: 2,
        success: 1,
        error: 1,
        latestReport: expect.objectContaining({
          endpoint: 'swap-plan',
          status: 'error',
          paymentTxHash: 'tx-2',
        }),
        latestSuccess: expect.objectContaining({
          endpoint: 'swap-plan',
          status: 'success',
          paymentTxHash: 'tx-1',
        }),
        latestError: expect.objectContaining({
          endpoint: 'swap-plan',
          status: 'error',
          paymentTxHash: 'tx-2',
        }),
        errorKinds: [
          { kind: 'executionError', count: 1 },
          { kind: 'simulationError', count: 1 },
        ],
      },
      {
        endpoint: 'wallet-profile',
        total: 1,
        success: 1,
        error: 0,
        latestReport: expect.objectContaining({
          endpoint: 'wallet-profile',
          status: 'success',
          paymentTxHash: 'tx-3',
        }),
        latestSuccess: expect.objectContaining({
          endpoint: 'wallet-profile',
          status: 'success',
          paymentTxHash: 'tx-3',
        }),
        latestError: undefined,
        errorKinds: [],
      },
    ]);
  });

  it('looks up the latest report by payment transaction hash', async () => {
    const record = makeAuditReportRecord({
      id: 'report-by-payment',
      endpoint: 'wallet-profile',
      paymentTxHash: 'payment-hash-123',
      generatedAt: new Date('2026-04-07T12:00:00.000Z'),
    });

    prisma.auditReport.findFirst.mockResolvedValue(record);

    const result = await service.getLatestReportByPaymentTxHash(
      'payment-hash-123',
    );

    expect(prisma.auditReport.findFirst).toHaveBeenCalledWith({
      where: { paymentTxHash: 'payment-hash-123' },
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'report-by-payment',
        paymentTxHash: 'payment-hash-123',
      }),
    );
  });
});

function makeAuditReportRecord(
  overrides: Partial<AuditReport>,
): AuditReport {
  const now = new Date('2026-04-07T11:00:00.000Z');
  return {
    id: overrides.id ?? 'report-id',
    schemaVersion: overrides.schemaVersion ?? 1,
    kind: overrides.kind ?? 'paid-intel-audit-report',
    status: overrides.status ?? 'success',
    endpoint: overrides.endpoint ?? 'swap-plan',
    generatedAt: overrides.generatedAt ?? new Date('2026-04-07T08:00:00.000Z'),
    sender: overrides.sender ?? 'erd1sender',
    facilitatorBaseUrl:
      overrides.facilitatorBaseUrl ?? 'http://localhost:3000',
    receipt: overrides.receipt ?? 'receipt-123',
    paymentTxHash: overrides.paymentTxHash ?? 'tx-hash-123',
    errorKinds: overrides.errorKinds ?? '[]',
    requestJson: overrides.requestJson ?? JSON.stringify({ kind: 'swap-plan' }),
    executionPolicyJson:
      overrides.executionPolicyJson ?? JSON.stringify({ maxActionCount: 4 }),
    resultJson:
      overrides.resultJson ??
      JSON.stringify({
        endpoint: 'swap-plan',
        execution: {
          executions: [],
        },
      }),
    reportJson:
      overrides.reportJson ??
      JSON.stringify({
        schemaVersion: 1,
        kind: 'paid-intel-audit-report',
        status: overrides.status ?? 'success',
        generatedAt:
          (overrides.generatedAt ?? new Date('2026-04-07T08:00:00.000Z')).toISOString(),
        endpoint: overrides.endpoint ?? 'swap-plan',
        request: { kind: 'swap-plan' },
        payment: {
          sender: overrides.sender ?? 'erd1sender',
          facilitatorBaseUrl:
            overrides.facilitatorBaseUrl ?? 'http://localhost:3000',
          receipt:
            overrides.receipt === undefined ? 'receipt-123' : overrides.receipt,
          paymentTxHash:
            overrides.paymentTxHash === undefined
              ? 'tx-hash-123'
              : overrides.paymentTxHash,
        },
        executionPolicy: { maxActionCount: 4 },
        result: {
          endpoint: overrides.endpoint ?? 'swap-plan',
        },
      }),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
