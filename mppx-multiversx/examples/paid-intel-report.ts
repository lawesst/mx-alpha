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

export type UploadedPaidIntelAuditReportSummary = {
  id: string
  endpoint: string
  status: 'success' | 'error'
  generatedAt: string
  paymentTxHash: string | null
  hasReceipt: boolean
  errorKinds: string[]
  sender: string
  facilitatorBaseUrl: string
  createdAt: string
  updatedAt: string
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

export async function uploadPaidIntelAuditReport(parameters: {
  report: PaidIntelAuditReport
  baseUrl?: string
  uploadUrl?: string
  fetchImpl?: typeof fetch
}): Promise<UploadedPaidIntelAuditReportSummary> {
  const fetchImpl = parameters.fetchImpl ?? fetch
  const url = resolvePaidIntelAuditUploadUrl(parameters)

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(parameters.report),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Audit report upload failed with status ${response.status}: ${body || response.statusText}`,
    )
  }

  const payload = (await response.json()) as unknown
  return parseUploadedPaidIntelAuditReportSummary(payload)
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

function resolvePaidIntelAuditUploadUrl(parameters: {
  report?: PaidIntelAuditReport
  baseUrl?: string
  uploadUrl?: string
}): string {
  if (parameters.uploadUrl) {
    return parameters.uploadUrl
  }
  const baseUrl = parameters.baseUrl ?? parameters.report?.payment.facilitatorBaseUrl
  if (baseUrl) {
    return new URL('/audit-reports', baseUrl).toString()
  }
  throw new Error('Either baseUrl or uploadUrl is required to upload an audit report.')
}

function parseUploadedPaidIntelAuditReportSummary(
  value: unknown,
): UploadedPaidIntelAuditReportSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('Uploaded audit report summary must be an object.')
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error('Uploaded audit report summary is missing a valid id.')
  }
  if (typeof candidate.endpoint !== 'string' || candidate.endpoint.length === 0) {
    throw new Error('Uploaded audit report summary is missing a valid endpoint.')
  }
  if (candidate.status !== 'success' && candidate.status !== 'error') {
    throw new Error('Uploaded audit report summary is missing a valid status.')
  }
  if (typeof candidate.generatedAt !== 'string') {
    throw new Error('Uploaded audit report summary is missing generatedAt.')
  }
  if (
    candidate.paymentTxHash !== null &&
    candidate.paymentTxHash !== undefined &&
    typeof candidate.paymentTxHash !== 'string'
  ) {
    throw new Error('Uploaded audit report summary has an invalid paymentTxHash.')
  }
  if (typeof candidate.hasReceipt !== 'boolean') {
    throw new Error('Uploaded audit report summary is missing hasReceipt.')
  }
  if (
    !Array.isArray(candidate.errorKinds) ||
    !candidate.errorKinds.every((item) => typeof item === 'string')
  ) {
    throw new Error('Uploaded audit report summary has invalid errorKinds.')
  }
  if (typeof candidate.sender !== 'string' || candidate.sender.length === 0) {
    throw new Error('Uploaded audit report summary is missing a valid sender.')
  }
  if (
    typeof candidate.facilitatorBaseUrl !== 'string' ||
    candidate.facilitatorBaseUrl.length === 0
  ) {
    throw new Error('Uploaded audit report summary is missing a valid facilitatorBaseUrl.')
  }
  if (
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    throw new Error('Uploaded audit report summary is missing timestamps.')
  }

  return candidate as UploadedPaidIntelAuditReportSummary
}

function sanitizeForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report'
}
