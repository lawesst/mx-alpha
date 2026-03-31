import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildPaidIntelAuditReport,
  createPaidIntelAuditFilename,
  persistPaidIntelAuditReport,
} from './paid-intel-report.ts'

describe('paid intel audit reporting', () => {
  it('builds a success audit report with payment metadata', () => {
    const report = buildPaidIntelAuditReport({
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
        from: 'EGLD',
        to: 'RIDE-7d18e9',
        amount: '1.25',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt-value',
      paymentTxHash: 'payment-tx-hash',
      executionPolicy: {
        maxActionCount: 4,
      },
      result: {
        endpoint: 'swap-plan',
        execution: {
          executions: [],
        },
      },
      generatedAt: '2026-03-31T10:00:00.000Z',
    })

    expect(report).toEqual({
      schemaVersion: 1,
      kind: 'paid-intel-audit-report',
      status: 'success',
      generatedAt: '2026-03-31T10:00:00.000Z',
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
        receipt: 'receipt-value',
        paymentTxHash: 'payment-tx-hash',
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
    })
  })

  it('marks reports as error when result contains error sections', () => {
    const report = buildPaidIntelAuditReport({
      endpoint: 'swap-plan',
      request: {
        kind: 'swap-plan',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: null,
      paymentTxHash: 'payment-tx-hash',
      result: {
        executionError: {
          message: 'something failed',
        },
      },
      generatedAt: '2026-03-31T10:00:00.000Z',
    })

    expect(report.status).toBe('error')
  })

  it('creates a sanitized audit filename', () => {
    const fileName = createPaidIntelAuditFilename({
      endpoint: 'Swap Plan',
      status: 'success',
      now: new Date('2026-03-31T10:00:00.000Z'),
    })

    expect(fileName).toBe('2026-03-31T10-00-00-000Z-swap-plan-success.json')
  })

  it('writes the audit report to the requested directory', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mx-alpha-report-'))
    const report = buildPaidIntelAuditReport({
      endpoint: 'wallet-profile',
      request: {
        kind: 'wallet-profile',
        address: 'erd1wallet',
      },
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      receipt: 'receipt-value',
      paymentTxHash: 'payment-tx-hash',
      result: {
        endpoint: 'wallet-profile',
        payload: {
          label: 'example',
        },
      },
      generatedAt: '2026-03-31T10:00:00.000Z',
    })

    const reportPath = await persistPaidIntelAuditReport({
      report,
      outputDir: temporaryDirectory,
      now: new Date('2026-03-31T10:00:00.000Z'),
    })

    expect(reportPath).toBe(
      path.join(
        temporaryDirectory,
        '2026-03-31T10-00-00-000Z-wallet-profile-success.json',
      ),
    )

    const writtenContent = await readFile(reportPath!, 'utf8')
    expect(JSON.parse(writtenContent)).toEqual(report)
  })
})
