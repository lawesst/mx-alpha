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
  dashboardPath: string
}> {
  await mkdir(parameters.outputDir, { recursive: true })

  const indexPath = path.join(parameters.outputDir, 'index.json')
  const latestSuccessPath = path.join(parameters.outputDir, 'latest-success.json')
  const summaryPath = path.join(parameters.outputDir, 'summary.md')
  const dashboardPath = path.join(parameters.outputDir, 'index.html')

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
  await writeFile(
    dashboardPath,
    renderPaidIntelAuditDashboardHtml(parameters.index),
    'utf8',
  )

  return {
    indexPath,
    latestSuccessPath,
    summaryPath,
    dashboardPath,
  }
}

export function renderPaidIntelAuditDashboardHtml(
  index: PaidIntelAuditReportIndex,
): string {
  const endpointCards =
    index.endpoints.length > 0
      ? index.endpoints
          .map((endpoint) => {
            const latest = endpoint.latestReport
              ? `${escapeHtml(endpoint.latestReport.generatedAt)} (${escapeHtml(endpoint.latestReport.status)})`
              : 'n/a'
            const errorKinds =
              endpoint.errorKinds.length > 0
                ? endpoint.errorKinds
                    .map((kind) => `${escapeHtml(kind.kind)} (${kind.count})`)
                    .join(', ')
                : 'none'

            return `
              <article class="card endpoint-card">
                <h3>${escapeHtml(endpoint.endpoint)}</h3>
                <dl class="stats">
                  <div><dt>Total</dt><dd>${endpoint.total}</dd></div>
                  <div><dt>Success</dt><dd>${endpoint.success}</dd></div>
                  <div><dt>Error</dt><dd>${endpoint.error}</dd></div>
                </dl>
                <p><strong>Latest:</strong> ${latest}</p>
                <p><strong>Error kinds:</strong> ${errorKinds}</p>
              </article>
            `
          })
          .join('\n')
      : '<p class="empty">No valid reports found.</p>'

  const reportRows =
    index.reports.length > 0
      ? index.reports
          .map(
            (report) => `
              <tr>
                <td>${escapeHtml(report.endpoint)}</td>
                <td><span class="status status-${escapeHtml(report.status)}">${escapeHtml(report.status)}</span></td>
                <td>${escapeHtml(report.generatedAt)}</td>
                <td>${escapeHtml(report.paymentTxHash ?? 'n/a')}</td>
                <td>${report.hasReceipt ? 'yes' : 'no'}</td>
                <td>${escapeHtml(report.errorKinds.join(', ') || 'none')}</td>
                <td title="${escapeHtml(report.path)}">${escapeHtml(path.basename(report.path))}</td>
              </tr>
            `,
          )
          .join('\n')
      : `
          <tr>
            <td colspan="7" class="empty-cell">No reports available.</td>
          </tr>
        `

  const invalidRows =
    index.invalidReports.length > 0
      ? index.invalidReports
          .map(
            (invalidReport) => `
              <tr>
                <td title="${escapeHtml(invalidReport.path)}">${escapeHtml(path.basename(invalidReport.path))}</td>
                <td>${escapeHtml(invalidReport.error)}</td>
              </tr>
            `,
          )
          .join('\n')
      : `
          <tr>
            <td colspan="2" class="empty-cell">No invalid reports.</td>
          </tr>
        `

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mx-alpha Audit Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffaf1;
        --ink: #18222f;
        --muted: #5e6c79;
        --line: #d7c7b0;
        --accent: #0f766e;
        --accent-soft: #d8efe9;
        --error: #b42318;
        --error-soft: #f7d8d2;
        --success: #166534;
        --success-soft: #d8f1da;
        --shadow: 0 18px 50px rgba(24, 34, 47, 0.08);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 28%),
          radial-gradient(circle at top right, rgba(180, 35, 24, 0.10), transparent 22%),
          var(--bg);
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 48px 20px 80px;
      }

      .hero {
        background: linear-gradient(135deg, rgba(255, 250, 241, 0.95), rgba(248, 238, 222, 0.95));
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
        padding: 28px;
      }

      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 14px 0 8px;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: clamp(2rem, 4vw, 3.4rem);
        line-height: 1.05;
      }

      p.meta {
        margin: 6px 0;
        color: var(--muted);
      }

      .totals {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 14px;
        margin-top: 28px;
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: var(--shadow);
      }

      .metric {
        padding: 18px;
      }

      .metric dt {
        color: var(--muted);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .metric dd {
        margin: 8px 0 0;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: 2rem;
        font-weight: 700;
      }

      section {
        margin-top: 30px;
      }

      section h2 {
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: 1.4rem;
        margin-bottom: 14px;
      }

      .endpoint-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
      }

      .endpoint-card {
        padding: 18px;
      }

      .endpoint-card h3 {
        margin-top: 0;
        margin-bottom: 14px;
        font-size: 1.05rem;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin: 0 0 16px;
      }

      .stats div {
        padding: 12px;
        border-radius: 14px;
        background: rgba(15, 118, 110, 0.06);
      }

      .stats dt {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
      }

      .stats dd {
        margin: 8px 0 0;
        font-size: 1.15rem;
        font-weight: 700;
      }

      .table-wrap {
        overflow-x: auto;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        padding: 14px 16px;
        text-align: left;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }

      th {
        background: rgba(24, 34, 47, 0.04);
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      tr:last-child td {
        border-bottom: none;
      }

      .status {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .status-success {
        background: var(--success-soft);
        color: var(--success);
      }

      .status-error {
        background: var(--error-soft);
        color: var(--error);
      }

      .empty,
      .empty-cell {
        color: var(--muted);
      }

      .footer {
        margin-top: 28px;
        color: var(--muted);
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">mx-alpha</span>
        <h1>Paid Intel Audit Dashboard</h1>
        <p class="meta">Generated at ${escapeHtml(index.generatedAt)}</p>
        <p class="meta">Source directory: ${escapeHtml(index.sourceDir)}</p>
        <div class="totals">
          <dl class="card metric">
            <dt>Reports</dt>
            <dd>${index.totals.reports}</dd>
          </dl>
          <dl class="card metric">
            <dt>Success</dt>
            <dd>${index.totals.success}</dd>
          </dl>
          <dl class="card metric">
            <dt>Error</dt>
            <dd>${index.totals.error}</dd>
          </dl>
          <dl class="card metric">
            <dt>Invalid</dt>
            <dd>${index.totals.invalid}</dd>
          </dl>
        </div>
      </section>

      <section>
        <h2>Endpoint Health</h2>
        <div class="endpoint-grid">
          ${endpointCards}
        </div>
      </section>

      <section>
        <h2>Recent Reports</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Generated</th>
                <th>Payment Tx</th>
                <th>Receipt</th>
                <th>Error Kinds</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              ${reportRows}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Invalid Reports</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              ${invalidRows}
            </tbody>
          </table>
        </div>
      </section>

      <p class="footer">Generated by the mx-alpha paid intel report indexer.</p>
    </main>
  </body>
</html>
`
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
