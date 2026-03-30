import { describe, expect, it, vi } from 'vitest'
import { charge } from './Charge.js'
import { Challenge, Credential, Errors } from 'mppx'

describe('server charge intent', () => {
  it('should successfully verify a valid transaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({ success: true })

    const chargeMethod = charge({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: { amount: '1000', currency: 'EGLD', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    const verification = await chargeMethod.verify({
      credential,
      request: { amount: '1000', currency: 'EGLD', recipient: 'erd1rec' },
    })

    expect(mockVerify).toHaveBeenCalledWith({
      txHash: '0x123',
      sender: 'erd1sender',
      challengeId: 'abc',
      amount: '1000',
      currency: 'EGLD',
    })

    expect(verification.status).toBe('success')
    expect(verification.reference).toBe('0x123')
    expect(verification.method).toBe('multiversx')
    expect(verification.timestamp).toBeDefined()
  })

  it('should throw VerificationFailedError on verification failure', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      success: false,
      error: 'Transaction not found',
    })

    const chargeMethod = charge({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: { amount: '1000', currency: 'EGLD', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    await expect(
      chargeMethod.verify({
        credential,
        request: { amount: '1000', currency: 'EGLD', recipient: 'erd1rec' },
      }),
    ).rejects.toThrow(Errors.VerificationFailedError)
  })

  it('should propagate error reason from verifyTransaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      success: false,
      error: 'Amount mismatch',
    })

    const chargeMethod = charge({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
    })

    const challenge = Challenge.from({
      id: 'test',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: { amount: '500', currency: 'EGLD', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: { txHash: '0xabc', sender: 'erd1sender' },
    })

    try {
      await chargeMethod.verify({
        credential,
        request: { amount: '500', currency: 'EGLD', recipient: 'erd1rec' },
      })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(Errors.VerificationFailedError)
      expect(e.message).toContain('Amount mismatch')
    }
  })

  it('should include externalId in receipt when present in credential', async () => {
    const mockVerify = vi.fn().mockResolvedValue({ success: true })

    const chargeMethod = charge({
      verifyTransaction: mockVerify,
      currency: 'USDC-c76f31',
    })

    const challenge = Challenge.from({
      id: 'ext-test',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: { amount: '100', currency: 'USDC-c76f31', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: { txHash: '0xdef', sender: 'erd1sender', externalId: 'order-42' },
    })

    const receipt = await chargeMethod.verify({
      credential,
      request: { amount: '100', currency: 'USDC-c76f31', recipient: 'erd1rec' },
    })

    expect(receipt.externalId).toBe('order-42')
  })

  it('should throw on invalid credential payload (missing txHash)', async () => {
    const mockVerify = vi.fn()

    const chargeMethod = charge({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
    })

    const challenge = Challenge.from({
      id: 'invalid',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: { amount: '1', currency: 'EGLD', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: { sender: 'erd1sender' } as any, // missing txHash
    })

    await expect(
      chargeMethod.verify({
        credential,
        request: { amount: '1', currency: 'EGLD', recipient: 'erd1rec' },
      }),
    ).rejects.toThrow()
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
