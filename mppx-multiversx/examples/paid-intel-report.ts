import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type PaidIntelAuditReport = {
  schemaVersion: 1
  kind: 'paid-intel-audit-report'
  status: 'success' | 'error'
  generatedAt: string
  endpoint: string
  request: Record<string, unknown>
  payment: {
    sender: string
    facilitatorBaseUrl: string
    receipt: string | null
    paymentTxHash: string | null
  }
  executionPolicy?: Record<string, unknown>
  result: Record<string, unknown>
}

export function buildPaidIntelAuditReport(parameters: {
  endpoint: string
  request: Record<string, unknown>
  sender: string
  facilitatorBaseUrl: string
  receipt: string | null
  paymentTxHash: string | null
  executionPolicy?: Record<string, unknown>
  result: Record<string, unknown>
  generatedAt?: string
}): PaidIntelAuditReport {
  return {
    schemaVersion: 1,
    kind: 'paid-intel-audit-report',
    status: inferReportStatus(parameters.result),
    generatedAt: parameters.generatedAt ?? new Date().toISOString(),
    endpoint: parameters.endpoint,
    request: parameters.request,
    payment: {
      sender: parameters.sender,
      facilitatorBaseUrl: parameters.facilitatorBaseUrl,
      receipt: parameters.receipt,
      paymentTxHash: parameters.paymentTxHash,
    },
    ...(parameters.executionPolicy
      ? { executionPolicy: parameters.executionPolicy }
      : {}),
    result: parameters.result,
  }
}

export async function persistPaidIntelAuditReport(parameters: {
  report: PaidIntelAuditReport
  outputDir?: string
  outputFile?: string
  now?: Date
}): Promise<string | undefined> {
  if (!parameters.outputDir && !parameters.outputFile) {
    return undefined
  }

  const outputPath =
    parameters.outputFile ??
    path.join(
      parameters.outputDir!,
      createPaidIntelAuditFilename({
        endpoint: parameters.report.endpoint,
        status: parameters.report.status,
        now: parameters.now,
      }),
    )

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(parameters.report, null, 2)}\n`, 'utf8')

  return outputPath
}

export function createPaidIntelAuditFilename(parameters: {
  endpoint: string
  status: 'success' | 'error'
  now?: Date
}): string {
  const timestamp = (parameters.now ?? new Date())
    .toISOString()
    .replace(/[:.]/g, '-')
  const endpoint = sanitizeForFilename(parameters.endpoint)

  return `${timestamp}-${endpoint}-${parameters.status}.json`
}

function inferReportStatus(result: Record<string, unknown>): 'success' | 'error' {
  return Object.keys(result).some((key) => key.toLowerCase().includes('error'))
    ? 'error'
    : 'success'
}

function sanitizeForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report'
}
