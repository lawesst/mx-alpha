import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditReport, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type PaidIntelAuditReportStatus = 'success' | 'error';

export type PaidIntelAuditReport = {
  schemaVersion: 1;
  kind: 'paid-intel-audit-report';
  status: PaidIntelAuditReportStatus;
  generatedAt: string;
  endpoint: string;
  request: Record<string, unknown>;
  payment: {
    sender: string;
    facilitatorBaseUrl: string;
    receipt: string | null;
    paymentTxHash: string | null;
  };
  executionPolicy?: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type StoredPaidIntelAuditReportSummary = {
  id: string;
  endpoint: string;
  status: PaidIntelAuditReportStatus;
  generatedAt: string;
  paymentTxHash: string | null;
  hasReceipt: boolean;
  errorKinds: string[];
  sender: string;
  facilitatorBaseUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredPaidIntelAuditReportDetail =
  StoredPaidIntelAuditReportSummary & {
    report: PaidIntelAuditReport;
  };

export type StoredPaidIntelAuditEndpointSummary = {
  endpoint: string;
  total: number;
  success: number;
  error: number;
  latestReport?: StoredPaidIntelAuditReportSummary;
  latestSuccess?: StoredPaidIntelAuditReportSummary;
  latestError?: StoredPaidIntelAuditReportSummary;
  errorKinds: Array<{
    kind: string;
    count: number;
  }>;
};

export type StoredPaidIntelAuditReportList = {
  schemaVersion: 1;
  kind: 'stored-paid-intel-audit-report-list';
  generatedAt: string;
  filters: {
    endpoint?: string;
    paymentTxHash?: string;
    status?: PaidIntelAuditReportStatus;
    limit: number;
  };
  count: number;
  reports: StoredPaidIntelAuditReportSummary[];
};

export type StoredPaidIntelAuditReportSummaryResponse = {
  schemaVersion: 1;
  kind: 'stored-paid-intel-audit-report-summary';
  generatedAt: string;
  filters: {
    endpoint?: string;
    paymentTxHash?: string;
  };
  totals: {
    reports: number;
    success: number;
    error: number;
  };
  endpoints: StoredPaidIntelAuditEndpointSummary[];
};

@Injectable()
export class AuditReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestReport(
    payload: unknown,
  ): Promise<StoredPaidIntelAuditReportSummary> {
    const report = parsePaidIntelAuditReport(payload);
    const errorKinds = extractErrorKinds(report);

    const created = await this.prisma.auditReport.create({
      data: {
        schemaVersion: report.schemaVersion,
        kind: report.kind,
        status: report.status,
        endpoint: report.endpoint,
        generatedAt: new Date(report.generatedAt),
        sender: report.payment.sender,
        facilitatorBaseUrl: report.payment.facilitatorBaseUrl,
        receipt: report.payment.receipt,
        paymentTxHash: report.payment.paymentTxHash,
        errorKinds: JSON.stringify(errorKinds),
        requestJson: JSON.stringify(report.request),
        executionPolicyJson: report.executionPolicy
          ? JSON.stringify(report.executionPolicy)
          : null,
        resultJson: JSON.stringify(report.result),
        reportJson: JSON.stringify(report),
      },
    });

    return toStoredReportSummary(created);
  }

  async listReports(parameters: {
    endpoint?: string;
    paymentTxHash?: string;
    status?: PaidIntelAuditReportStatus;
    limit?: number;
  }): Promise<StoredPaidIntelAuditReportList> {
    const limit = parameters.limit ?? 25;
    const records = await this.prisma.auditReport.findMany({
      where: buildWhere(parameters),
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return {
      schemaVersion: 1,
      kind: 'stored-paid-intel-audit-report-list',
      generatedAt: new Date().toISOString(),
      filters: {
        ...(parameters.endpoint ? { endpoint: parameters.endpoint } : {}),
        ...(parameters.paymentTxHash
          ? { paymentTxHash: parameters.paymentTxHash }
          : {}),
        ...(parameters.status ? { status: parameters.status } : {}),
        limit,
      },
      count: records.length,
      reports: records.map(toStoredReportSummary),
    };
  }

  async getSummary(parameters: {
    endpoint?: string;
    paymentTxHash?: string;
  }): Promise<StoredPaidIntelAuditReportSummaryResponse> {
    const records = await this.prisma.auditReport.findMany({
      where: buildWhere(parameters),
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const reports = records.map(toStoredReportSummary);
    const endpoints = buildEndpointSummaries(reports);

    return {
      schemaVersion: 1,
      kind: 'stored-paid-intel-audit-report-summary',
      generatedAt: new Date().toISOString(),
      filters: {
        ...(parameters.endpoint ? { endpoint: parameters.endpoint } : {}),
        ...(parameters.paymentTxHash
          ? { paymentTxHash: parameters.paymentTxHash }
          : {}),
      },
      totals: {
        reports: reports.length,
        success: reports.filter((report) => report.status === 'success').length,
        error: reports.filter((report) => report.status === 'error').length,
      },
      endpoints,
    };
  }

  async getReport(id: string): Promise<StoredPaidIntelAuditReportDetail> {
    const record = await this.prisma.auditReport.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(`Audit report "${id}" was not found`);
    }

    return toStoredReportDetail(record);
  }

  async getLatestReportByPaymentTxHash(
    paymentTxHash: string,
  ): Promise<StoredPaidIntelAuditReportDetail> {
    const record = await this.prisma.auditReport.findFirst({
      where: { paymentTxHash },
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!record) {
      throw new NotFoundException(
        `Audit report for payment transaction "${paymentTxHash}" was not found`,
      );
    }

    return toStoredReportDetail(record);
  }
}

function parsePaidIntelAuditReport(value: unknown): PaidIntelAuditReport {
  if (!isRecord(value)) {
    throw new BadRequestException('Report payload must be an object');
  }

  if (value.schemaVersion !== 1) {
    throw new BadRequestException(
      `Unsupported schemaVersion: ${String(value.schemaVersion)}`,
    );
  }
  if (value.kind !== 'paid-intel-audit-report') {
    throw new BadRequestException(`Unsupported kind: ${String(value.kind)}`);
  }
  if (value.status !== 'success' && value.status !== 'error') {
    throw new BadRequestException(
      `Unsupported status: ${String(value.status)}`,
    );
  }

  return {
    schemaVersion: 1,
    kind: 'paid-intel-audit-report',
    status: value.status,
    generatedAt: requireIsoTimestamp(value.generatedAt, 'generatedAt'),
    endpoint: requireNonEmptyString(value.endpoint, 'endpoint'),
    request: requireObject(value.request, 'request'),
    payment: parsePayment(value.payment),
    ...(value.executionPolicy === undefined
      ? {}
      : {
          executionPolicy: requireObject(
            value.executionPolicy,
            'executionPolicy',
          ),
        }),
    result: requireObject(value.result, 'result'),
  };
}

function parsePayment(value: unknown): PaidIntelAuditReport['payment'] {
  const payment = requireObject(value, 'payment');

  return {
    sender: requireNonEmptyString(payment.sender, 'payment.sender'),
    facilitatorBaseUrl: requireNonEmptyString(
      payment.facilitatorBaseUrl,
      'payment.facilitatorBaseUrl',
    ),
    receipt: requireNullableString(payment.receipt, 'payment.receipt'),
    paymentTxHash: requireNullableString(
      payment.paymentTxHash,
      'payment.paymentTxHash',
    ),
  };
}

function buildWhere(parameters: {
  endpoint?: string;
  paymentTxHash?: string;
  status?: PaidIntelAuditReportStatus;
}): Prisma.AuditReportWhereInput {
  return {
    ...(parameters.endpoint ? { endpoint: parameters.endpoint } : {}),
    ...(parameters.paymentTxHash
      ? { paymentTxHash: parameters.paymentTxHash }
      : {}),
    ...(parameters.status ? { status: parameters.status } : {}),
  };
}

function toStoredReportSummary(
  record: AuditReport,
): StoredPaidIntelAuditReportSummary {
  return {
    id: record.id,
    endpoint: record.endpoint,
    status: record.status as PaidIntelAuditReportStatus,
    generatedAt: record.generatedAt.toISOString(),
    paymentTxHash: record.paymentTxHash,
    hasReceipt: record.receipt !== null,
    errorKinds: parseStringArray(record.errorKinds),
    sender: record.sender,
    facilitatorBaseUrl: record.facilitatorBaseUrl,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toStoredReportDetail(
  record: AuditReport,
): StoredPaidIntelAuditReportDetail {
  return {
    ...toStoredReportSummary(record),
    report: parseStoredReport(record.reportJson),
  };
}

function buildEndpointSummaries(
  reports: StoredPaidIntelAuditReportSummary[],
): StoredPaidIntelAuditEndpointSummary[] {
  const grouped = new Map<string, StoredPaidIntelAuditReportSummary[]>();

  for (const report of reports) {
    const existing = grouped.get(report.endpoint) ?? [];
    existing.push(report);
    grouped.set(report.endpoint, existing);
  }

  return [...grouped.entries()]
    .map(([endpoint, endpointReports]) => {
      const errorKindCounts = new Map<string, number>();
      endpointReports.forEach((report) => {
        report.errorKinds.forEach((kind) => {
          errorKindCounts.set(kind, (errorKindCounts.get(kind) ?? 0) + 1);
        });
      });

      return {
        endpoint,
        total: endpointReports.length,
        success: endpointReports.filter((report) => report.status === 'success')
          .length,
        error: endpointReports.filter((report) => report.status === 'error')
          .length,
        latestReport: endpointReports[0],
        latestSuccess: endpointReports.find(
          (report) => report.status === 'success',
        ),
        latestError: endpointReports.find((report) => report.status === 'error'),
        errorKinds: [...errorKindCounts.entries()]
          .map(([kind, count]) => ({ kind, count }))
          .sort((left, right) => left.kind.localeCompare(right.kind)),
      };
    })
    .sort((left, right) => left.endpoint.localeCompare(right.endpoint));
}

function extractErrorKinds(report: PaidIntelAuditReport): string[] {
  return Object.keys(report.result)
    .filter((key) => key.toLowerCase().includes('error'))
    .sort();
}

function parseStoredReport(value: string): PaidIntelAuditReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException('Stored report JSON is invalid');
  }

  return parsePaidIntelAuditReport(parsed);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return [...parsed].sort();
    }
  } catch {
    return [];
  }
  return [];
}

function requireObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BadRequestException(`${fieldName} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireNullableString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string or null`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireNonEmptyString(value, fieldName);
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new BadRequestException(`${fieldName} must be a valid ISO timestamp`);
  }
  return new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
