import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { PaidIntelAuditReport } from './paid-intel-report.ts'

export type PaidIntelAuditReportRecord = {
  path: string
  report: PaidIntelAuditReport
}

export type PaidIntelInvalidAuditReport = {
  path: string
  error: string
}

export type PaidIntelAuditReportSummary = {
  path: string
  endpoint: string
  status: 'success' | 'error'
  generatedAt: string
  paymentTxHash: string | null
  hasReceipt: boolean
  errorKinds: string[]
}

export type PaidIntelAuditEndpointSummary = {
  endpoint: string
  total: number
  success: number
  error: number
  latestReport?: PaidIntelAuditReportSummary
  latestSuccess?: PaidIntelAuditReportSummary
  latestError?: PaidIntelAuditReportSummary
  errorKinds: Array<{
    kind: string
    count: number
  }>
}

export type PaidIntelAuditReportIndex = {
  schemaVersion: 1
  kind: 'paid-intel-audit-report-index'
  generatedAt: string
  sourceDir: string
  totals: {
    reports: number
    success: number
    error: number
    invalid: number
  }
  reports: PaidIntelAuditReportSummary[]
  endpoints: PaidIntelAuditEndpointSummary[]
  invalidReports: PaidIntelInvalidAuditReport[]
}

export function parsePaidIntelAuditReport(
  value: unknown,
): PaidIntelAuditReport {
  if (!value || typeof value !== 'object') {
    throw new Error('Report payload is not an object')
  }

  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${String(candidate.schemaVersion)}`)
  }
  if (candidate.kind !== 'paid-intel-audit-report') {
    throw new Error(`Unsupported kind: ${String(candidate.kind)}`)
  }
  if (candidate.status !== 'success' && candidate.status !== 'error') {
    throw new Error(`Unsupported status: ${String(candidate.status)}`)
  }
  if (typeof candidate.generatedAt !== 'string') {
    throw new Error('generatedAt must be a string')
  }
  if (typeof candidate.endpoint !== 'string' || candidate.endpoint.length === 0) {
    throw new Error('endpoint must be a non-empty string')
  }
  if (!candidate.request || typeof candidate.request !== 'object') {
    throw new Error('request must be an object')
  }
  if (!candidate.payment || typeof candidate.payment !== 'object') {
    throw new Error('payment must be an object')
  }
  if (!candidate.result || typeof candidate.result !== 'object') {
    throw new Error('result must be an object')
  }

  const payment = candidate.payment as Record<string, unknown>
  if (typeof payment.sender !== 'string' || payment.sender.length === 0) {
    throw new Error('payment.sender must be a non-empty string')
  }
  if (
    typeof payment.facilitatorBaseUrl !== 'string' ||
    payment.facilitatorBaseUrl.length === 0
  ) {
    throw new Error('payment.facilitatorBaseUrl must be a non-empty string')
  }
  if (
    payment.receipt !== null &&
    payment.receipt !== undefined &&
    typeof payment.receipt !== 'string'
  ) {
    throw new Error('payment.receipt must be a string or null')
  }
  if (
    payment.paymentTxHash !== null &&
    payment.paymentTxHash !== undefined &&
    typeof payment.paymentTxHash !== 'string'
  ) {
    throw new Error('payment.paymentTxHash must be a string or null')
  }

  return candidate as PaidIntelAuditReport
}

export async function collectPaidIntelAuditReports(parameters: {
  reportsDir: string
}): Promise<{
  records: PaidIntelAuditReportRecord[]
  invalidReports: PaidIntelInvalidAuditReport[]
}> {
  const files = await collectJsonFiles(parameters.reportsDir)
  const records: PaidIntelAuditReportRecord[] = []
  const invalidReports: PaidIntelInvalidAuditReport[] = []

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content) as unknown
      records.push({
        path: filePath,
        report: parsePaidIntelAuditReport(parsed),
      })
    } catch (error) {
      invalidReports.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  records.sort((left, right) =>
    right.report.generatedAt.localeCompare(left.report.generatedAt),
  )

  return {
    records,
    invalidReports,
  }
}

export function buildPaidIntelAuditReportIndex(parameters: {
  reportsDir: string
  records: PaidIntelAuditReportRecord[]
  invalidReports?: PaidIntelInvalidAuditReport[]
  generatedAt?: string
}): PaidIntelAuditReportIndex {
  const reports = parameters.records.map(toReportSummary)
  const endpoints = buildEndpointSummaries(reports)
  const totals = {
    reports: reports.length,
    success: reports.filter((report) => report.status === 'success').length,
    error: reports.filter((report) => report.status === 'error').length,
    invalid: parameters.invalidReports?.length ?? 0,
  }

  return {
    schemaVersion: 1,
    kind: 'paid-intel-audit-report-index',
    generatedAt: parameters.generatedAt ?? new Date().toISOString(),
    sourceDir: parameters.reportsDir,
    totals,
    reports,
    endpoints,
    invalidReports: parameters.invalidReports ?? [],
  }
}

export function buildLatestSuccessfulReportMap(
  index: PaidIntelAuditReportIndex,
): Record<string, PaidIntelAuditReportSummary> {
  return Object.fromEntries(
    index.endpoints
      .filter((endpoint) => endpoint.latestSuccess)
      .map((endpoint) => [endpoint.endpoint, endpoint.latestSuccess!]),
  )
}

export function renderPaidIntelAuditSummaryMarkdown(
  index: PaidIntelAuditReportIndex,
): string {
  const lines = [
    '# Paid Intel Audit Summary',
    '',
    `Generated: ${index.generatedAt}`,
    `Source directory: ${index.sourceDir}`,
    '',
    '## Totals',
    '',
    `- Reports: ${index.totals.reports}`,
    `- Success: ${index.totals.success}`,
    `- Error: ${index.totals.error}`,
    `- Invalid: ${index.totals.invalid}`,
    '',
    '## Endpoints',
    '',
  ]

  if (index.endpoints.length === 0) {
    lines.push('No valid reports found.')
  } else {
    for (const endpoint of index.endpoints) {
      lines.push(`### ${endpoint.endpoint}`)
      lines.push('')
      lines.push(`- Total: ${endpoint.total}`)
      lines.push(`- Success: ${endpoint.success}`)
      lines.push(`- Error: ${endpoint.error}`)
      if (endpoint.latestReport) {
        lines.push(
          `- Latest: ${endpoint.latestReport.generatedAt} (${endpoint.latestReport.status})`,
        )
      }
      if (endpoint.latestSuccess) {
        lines.push(
          `- Latest success: ${endpoint.latestSuccess.generatedAt}`,
        )
      }
      if (endpoint.latestError) {
        lines.push(
          `- Latest error: ${endpoint.latestError.generatedAt}`,
        )
      }
      if (endpoint.errorKinds.length > 0) {
        lines.push(
          `- Error kinds: ${endpoint.errorKinds
            .map((kind) => `${kind.kind} (${kind.count})`)
            .join(', ')}`,
        )
      }
      lines.push('')
    }
  }

  if (index.invalidReports.length > 0) {
    lines.push('## Invalid Reports')
    lines.push('')
    for (const invalidReport of index.invalidReports) {
      lines.push(`- ${invalidReport.path}: ${invalidReport.error}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export async function persistPaidIntelAuditIndexArtifacts(parameters: {
  index: PaidIntelAuditReportIndex
  outputDir: string
}): Promise<{
  indexPath: string
  latestSuccessPath: string
  summaryPath: string
}> {
  await mkdir(parameters.outputDir, { recursive: true })

  const indexPath = path.join(parameters.outputDir, 'index.json')
  const latestSuccessPath = path.join(parameters.outputDir, 'latest-success.json')
  const summaryPath = path.join(parameters.outputDir, 'summary.md')

  await writeFile(indexPath, `${JSON.stringify(parameters.index, null, 2)}\n`, 'utf8')
  await writeFile(
    latestSuccessPath,
    `${JSON.stringify(buildLatestSuccessfulReportMap(parameters.index), null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    summaryPath,
    renderPaidIntelAuditSummaryMarkdown(parameters.index),
    'utf8',
  )

  return {
    indexPath,
    latestSuccessPath,
    summaryPath,
  }
}

async function collectJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return collectJsonFiles(entryPath)
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        return [entryPath]
      }
      return []
    }),
  )

  return nestedFiles.flat().sort()
}

function toReportSummary(record: PaidIntelAuditReportRecord): PaidIntelAuditReportSummary {
  return {
    path: record.path,
    endpoint: record.report.endpoint,
    status: record.report.status,
    generatedAt: record.report.generatedAt,
    paymentTxHash: record.report.payment.paymentTxHash,
    hasReceipt: record.report.payment.receipt !== null,
    errorKinds: extractErrorKinds(record.report),
  }
}

function buildEndpointSummaries(
  reports: PaidIntelAuditReportSummary[],
): PaidIntelAuditEndpointSummary[] {
  const grouped = new Map<string, PaidIntelAuditReportSummary[]>()

  for (const report of reports) {
    const existing = grouped.get(report.endpoint) ?? []
    existing.push(report)
    grouped.set(report.endpoint, existing)
  }

  return [...grouped.entries()]
    .map(([endpoint, endpointReports]) => {
      const errorKindCounts = new Map<string, number>()
      endpointReports.forEach((report) => {
        report.errorKinds.forEach((kind) => {
          errorKindCounts.set(kind, (errorKindCounts.get(kind) ?? 0) + 1)
        })
      })

      return {
        endpoint,
        total: endpointReports.length,
        success: endpointReports.filter((report) => report.status === 'success').length,
        error: endpointReports.filter((report) => report.status === 'error').length,
        latestReport: endpointReports[0],
        latestSuccess: endpointReports.find((report) => report.status === 'success'),
        latestError: endpointReports.find((report) => report.status === 'error'),
        errorKinds: [...errorKindCounts.entries()]
          .map(([kind, count]) => ({ kind, count }))
          .sort((left, right) =>
            left.kind.localeCompare(right.kind),
          ),
      }
    })
    .sort((left, right) => left.endpoint.localeCompare(right.endpoint))
}

function extractErrorKinds(report: PaidIntelAuditReport): string[] {
  return Object.keys(report.result)
    .filter((key) => key.toLowerCase().includes('error'))
    .sort()
}
