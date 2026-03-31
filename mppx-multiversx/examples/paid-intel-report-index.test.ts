import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPaidIntelAuditReport } from './paid-intel-report.ts'
import {
  buildLatestSuccessfulReportMap,
  buildPaidIntelAuditReportIndex,
  collectPaidIntelAuditReports,
  persistPaidIntelAuditIndexArtifacts,
  renderPaidIntelAuditDashboardHtml,
  renderPaidIntelAuditSummaryMarkdown,
} from './paid-intel-report-index.ts'

describe('paid intel audit report indexing', () => {
  it('collects valid reports and flags invalid JSON files', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mx-alpha-index-'))
    const validReport = buildPaidIntelAuditReport({
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt',
      paymentTxHash: 'payment-1',
      result: {
        payload: {},
      },
      generatedAt: '2026-03-31T10:00:00.000Z',
    })

    await writeFile(
      path.join(temporaryDirectory, 'valid.json'),
      JSON.stringify(validReport, null, 2),
      'utf8',
    )
    await writeFile(path.join(temporaryDirectory, 'invalid.json'), '{bad json', 'utf8')

    const collected = await collectPaidIntelAuditReports({
      reportsDir: temporaryDirectory,
    })

    expect(collected.records).toHaveLength(1)
    expect(collected.invalidReports).toHaveLength(1)
    expect(collected.invalidReports[0].path).toContain('invalid.json')
  })

  it('builds endpoint summaries and latest success maps', () => {
    const swapSuccess = buildPaidIntelAuditReport({
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt',
      paymentTxHash: 'payment-1',
      result: {
        execution: {},
      },
      generatedAt: '2026-03-31T10:00:00.000Z',
    })
    const swapError = buildPaidIntelAuditReport({
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt',
      paymentTxHash: 'payment-2',
      result: {
        executionError: {
          message: 'failed',
        },
      },
      generatedAt: '2026-03-31T11:00:00.000Z',
    })
    const walletSuccess = buildPaidIntelAuditReport({
      endpoint: 'wallet-profile',
      request: {
        kind: 'wallet-profile',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: null,
      paymentTxHash: null,
      result: {
        payload: {},
      },
      generatedAt: '2026-03-31T09:30:00.000Z',
    })

    const index = buildPaidIntelAuditReportIndex({
      reportsDir: '/tmp/reports',
      records: [
        {
          path: '/tmp/reports/swap-error.json',
          report: swapError,
        },
        {
          path: '/tmp/reports/swap-success.json',
          report: swapSuccess,
        },
        {
          path: '/tmp/reports/wallet-success.json',
          report: walletSuccess,
        },
      ],
      invalidReports: [
        {
          path: '/tmp/reports/bad.json',
          error: 'bad json',
        },
      ],
      generatedAt: '2026-03-31T12:00:00.000Z',
    })

    expect(index.totals).toEqual({
      reports: 3,
      success: 2,
      error: 1,
      invalid: 1,
    })
    expect(index.endpoints).toEqual([
      {
        endpoint: 'swap-plan',
        total: 2,
        success: 1,
        error: 1,
        latestReport: {
          path: '/tmp/reports/swap-error.json',
          endpoint: 'swap-plan',
          status: 'error',
          generatedAt: '2026-03-31T11:00:00.000Z',
          paymentTxHash: 'payment-2',
          hasReceipt: true,
          errorKinds: ['executionError'],
        },
        latestSuccess: {
          path: '/tmp/reports/swap-success.json',
          endpoint: 'swap-plan',
          status: 'success',
          generatedAt: '2026-03-31T10:00:00.000Z',
          paymentTxHash: 'payment-1',
          hasReceipt: true,
          errorKinds: [],
        },
        latestError: {
          path: '/tmp/reports/swap-error.json',
          endpoint: 'swap-plan',
          status: 'error',
          generatedAt: '2026-03-31T11:00:00.000Z',
          paymentTxHash: 'payment-2',
          hasReceipt: true,
          errorKinds: ['executionError'],
        },
        errorKinds: [
          {
            kind: 'executionError',
            count: 1,
          },
        ],
      },
      {
        endpoint: 'wallet-profile',
        total: 1,
        success: 1,
        error: 0,
        latestReport: {
          path: '/tmp/reports/wallet-success.json',
          endpoint: 'wallet-profile',
          status: 'success',
          generatedAt: '2026-03-31T09:30:00.000Z',
          paymentTxHash: null,
          hasReceipt: false,
          errorKinds: [],
        },
        latestSuccess: {
          path: '/tmp/reports/wallet-success.json',
          endpoint: 'wallet-profile',
          status: 'success',
          generatedAt: '2026-03-31T09:30:00.000Z',
          paymentTxHash: null,
          hasReceipt: false,
          errorKinds: [],
        },
        latestError: undefined,
        errorKinds: [],
      },
    ])

    expect(buildLatestSuccessfulReportMap(index)).toEqual({
      'swap-plan': {
        path: '/tmp/reports/swap-success.json',
        endpoint: 'swap-plan',
        status: 'success',
        generatedAt: '2026-03-31T10:00:00.000Z',
        paymentTxHash: 'payment-1',
        hasReceipt: true,
        errorKinds: [],
      },
      'wallet-profile': {
        path: '/tmp/reports/wallet-success.json',
        endpoint: 'wallet-profile',
        status: 'success',
        generatedAt: '2026-03-31T09:30:00.000Z',
        paymentTxHash: null,
        hasReceipt: false,
        errorKinds: [],
      },
    })
  })

  it('renders markdown and persists index artifacts', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mx-alpha-index-artifacts-'))
    const index = buildPaidIntelAuditReportIndex({
      reportsDir: temporaryDirectory,
      records: [
        {
          path: path.join(temporaryDirectory, 'wallet-success.json'),
          report: buildPaidIntelAuditReport({
            endpoint: 'wallet-profile',
            request: {
              kind: 'wallet-profile',
            },
            sender: 'erd1sender',
            facilitatorBaseUrl: 'http://localhost:3000',
            receipt: 'receipt',
            paymentTxHash: 'payment-1',
            result: {
              payload: {},
            },
            generatedAt: '2026-03-31T10:00:00.000Z',
          }),
        },
      ],
      generatedAt: '2026-03-31T12:00:00.000Z',
    })

    const markdown = renderPaidIntelAuditSummaryMarkdown(index)
    const dashboardHtml = renderPaidIntelAuditDashboardHtml(index)
    expect(markdown).toContain('# Paid Intel Audit Summary')
    expect(markdown).toContain('### wallet-profile')
    expect(dashboardHtml).toContain('<title>mx-alpha Audit Dashboard</title>')
    expect(dashboardHtml).toContain('wallet-profile')

    const artifacts = await persistPaidIntelAuditIndexArtifacts({
      index,
      outputDir: temporaryDirectory,
    })

    const indexJson = JSON.parse(await readFile(artifacts.indexPath, 'utf8'))
    const latestSuccessJson = JSON.parse(
      await readFile(artifacts.latestSuccessPath, 'utf8'),
    )
    const summaryMarkdown = await readFile(artifacts.summaryPath, 'utf8')
    const persistedDashboardHtml = await readFile(artifacts.dashboardPath, 'utf8')

    expect(indexJson.totals.reports).toBe(1)
    expect(Object.keys(latestSuccessJson)).toEqual(['wallet-profile'])
    expect(summaryMarkdown).toContain('wallet-profile')
    expect(persistedDashboardHtml).toContain('Paid Intel Audit Dashboard')
  })
})
