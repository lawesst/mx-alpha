import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildPaidIntelAuditReport,
  createPaidIntelAuditFilename,
  persistPaidIntelAuditReport,
  uploadPaidIntelAuditReport,
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

  it('uploads the audit report to the facilitator audit endpoint', async () => {
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

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'report-123',
          endpoint: 'wallet-profile',
          status: 'success',
          generatedAt: '2026-03-31T10:00:00.000Z',
          paymentTxHash: 'payment-tx-hash',
          hasReceipt: true,
          errorKinds: [],
          sender: 'erd1sender',
          facilitatorBaseUrl: 'http://localhost:3000',
          createdAt: '2026-03-31T10:00:01.000Z',
          updatedAt: '2026-03-31T10:00:01.000Z',
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    )

    const uploaded = await uploadPaidIntelAuditReport({
      report,
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/audit-reports',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
    expect(uploaded).toEqual({
      id: 'report-123',
      endpoint: 'wallet-profile',
      status: 'success',
      generatedAt: '2026-03-31T10:00:00.000Z',
      paymentTxHash: 'payment-tx-hash',
      hasReceipt: true,
      errorKinds: [],
      sender: 'erd1sender',
      facilitatorBaseUrl: 'http://localhost:3000',
      createdAt: '2026-03-31T10:00:01.000Z',
      updatedAt: '2026-03-31T10:00:01.000Z',
    })
  })

  it('throws when audit report upload fails', async () => {
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

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('bad request', { status: 400 }),
    )

    await expect(
      uploadPaidIntelAuditReport({
        report,
        uploadUrl: 'http://localhost:3000/audit-reports',
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Audit report upload failed with status 400: bad request',
    )
  })
})
