import { describe, expect, it, vi } from 'vitest'
import { session } from './Session.js'
import { Challenge, Credential, Errors } from 'mppx'

describe('server session intent', () => {
  it('should successfully verify a valid session transaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({ success: true })

    const sessionMethod = session({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      duration: '3600',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx' as const,
      intent: 'session' as const,
      request: { amount: '1000', currency: 'EGLD', duration: '3600', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    const verification = await sessionMethod.verify({
      credential,
      request: { amount: '1000', currency: 'EGLD', duration: '3600', recipient: 'erd1rec' },
    })

    expect(mockVerify).toHaveBeenCalledWith({
      txHash: '0x123',
      sender: 'erd1sender',
      challengeId: 'abc',
      amount: '1000',
      currency: 'EGLD',
      duration: '3600',
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

    const sessionMethod = session({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      duration: '3600',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx',
      intent: 'session',
      request: { amount: '1000', currency: 'EGLD', duration: '3600', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    await expect(
      sessionMethod.verify({
        credential,
        request: { amount: '1000', currency: 'EGLD', duration: '3600', recipient: 'erd1rec' },
      }),
    ).rejects.toThrow(Errors.VerificationFailedError)
  })

  it('should propagate error reason from verifyTransaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      success: false,
      error: 'Amount mismatch',
    })

    const sessionMethod = session({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      duration: '7200',
    })

    const challenge = Challenge.from({
      id: 'test',
      realm: 'example',
      method: 'multiversx',
      intent: 'session',
      request: { amount: '500', currency: 'EGLD', duration: '7200', recipient: 'erd1rec' },
    })

    const credential = Credential.from({
      challenge,
      payload: { txHash: '0xabc', sender: 'erd1sender' },
    })

    try {
      await sessionMethod.verify({
        credential,
        request: { amount: '500', currency: 'EGLD', duration: '7200', recipient: 'erd1rec' },
      })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(Errors.VerificationFailedError)
      expect(e.message).toContain('Amount mismatch')
    }
  })
})
