import { describe, expect, it } from 'vitest'
import { charge } from './Methods.js'

describe('mppx-multiversx charge method schema', () => {
  it('should format EGLD amounts with 18 decimal default', () => {
    const parsed = charge.schema.request.parse({
      amount: '1.5',
      currency: 'EGLD',
      recipient: 'erd1qqqqqqqqqqqqqpgq0lzzvt2faev4upyquhdh78',
    })

    // 1.5 EGLD with 18 decimals -> 1500000000000000000
    expect(parsed.amount).toBe('1500000000000000000')
    expect(parsed.currency).toBe('EGLD')
    expect(parsed.methodDetails?.chainId).toBe('D')
  })

  it('should format ESDT amounts with custom decimals', () => {
    const parsed = charge.schema.request.parse({
      amount: '50.25',
      currency: 'USDC-c76f31',
      recipient: 'erd1qqqqqqqqqqqqqpgq0lzzvt2faev4upyquhdh78',
      decimals: 6,
      chainId: '1',
    })

    // 50.25 USDC with 6 decimals -> 50250000
    expect(parsed.amount).toBe('50250000')
    expect(parsed.currency).toBe('USDC-c76f31')
    expect(parsed.methodDetails?.chainId).toBe('1')
  })

  it('should include currency field in output (spec compliance)', () => {
    const parsed = charge.schema.request.parse({
      amount: '10',
      currency: 'WEGLD-bd4d79',
      recipient: 'erd1...',
    })

    // currency MUST be present at top level per charge intent spec
    expect(parsed).toHaveProperty('currency')
    expect(parsed.currency).toBe('WEGLD-bd4d79')
  })

  it('should handle whole number amounts without decimals', () => {
    const parsed = charge.schema.request.parse({
      amount: '100',
      currency: 'EGLD',
      recipient: 'erd1...',
    })

    expect(parsed.amount).toBe('100000000000000000000')
  })

  it('should reject invalid amount strings', () => {
    expect(() =>
      charge.schema.request.parse({
        amount: 'abc',
        currency: 'EGLD',
        recipient: 'erd1...',
      }),
    ).toThrow()
  })

  it('should reject missing required fields', () => {
    // Missing currency
    expect(() =>
      charge.schema.request.parse({
        amount: '1',
        recipient: 'erd1...',
      }),
    ).toThrow()

    // Missing recipient
    expect(() =>
      charge.schema.request.parse({
        amount: '1',
        currency: 'EGLD',
      }),
    ).toThrow()
  })

  it('should preserve metadata in methodDetails', () => {
    const parsed = charge.schema.request.parse({
      amount: '1',
      currency: 'EGLD',
      recipient: 'erd1...',
      metadata: { orderId: 'abc123' },
    })

    expect(parsed.methodDetails?.metadata).toEqual({ orderId: 'abc123' })
  })

  it('should carry optional fields through', () => {
    const parsed = charge.schema.request.parse({
      amount: '1',
      currency: 'EGLD',
      recipient: 'erd1...',
      description: 'Test payment',
      externalId: 'ext-001',
    })

    expect(parsed.description).toBe('Test payment')
    expect(parsed.externalId).toBe('ext-001')
  })

  it('has correct method name and intent', () => {
    expect(charge.name).toBe('multiversx')
    expect(charge.intent).toBe('charge')
  })
})
