import { describe, expect, it, vi } from 'vitest'
import { subscription } from './Subscription.js'
import { Challenge, Credential, Errors } from 'mppx'

describe('server subscription intent', () => {
  it('should successfully verify a valid subscription transaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({ success: true })

    const subscriptionMethod = subscription({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      interval: 'monthly',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx' as const,
      intent: 'subscription' as const,
      request: { amount: '1000', currency: 'EGLD', interval: 'monthly', recipient: 'erd1rec' },
    }) as any

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    const verification = await subscriptionMethod.verify({
      credential,
      request: { amount: '1000', currency: 'EGLD', interval: 'monthly', recipient: 'erd1rec' },
    })

    expect(mockVerify).toHaveBeenCalledWith({
      txHash: '0x123',
      sender: 'erd1sender',
      challengeId: 'abc',
      amount: '1000',
      currency: 'EGLD',
      interval: 'monthly',
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

    const subscriptionMethod = subscription({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      interval: 'monthly',
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx',
      intent: 'subscription',
      request: { amount: '1000', currency: 'EGLD', interval: 'monthly', recipient: 'erd1rec' },
    }) as any

    const credential = Credential.from({
      challenge,
      payload: {
        txHash: '0x123',
        sender: 'erd1sender',
      },
    })

    await expect(
      subscriptionMethod.verify({
        credential,
        request: { amount: '1000', currency: 'EGLD', interval: 'monthly', recipient: 'erd1rec' },
      }),
    ).rejects.toThrow(Errors.VerificationFailedError)
  })

  it('should propagate error reason from verifyTransaction', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      success: false,
      error: 'Amount mismatch',
    })

    const subscriptionMethod = subscription({
      verifyTransaction: mockVerify,
      currency: 'EGLD',
      interval: 'yearly',
    })

    const challenge = Challenge.from({
      id: 'test',
      realm: 'example',
      method: 'multiversx',
      intent: 'subscription',
      request: { amount: '500', currency: 'EGLD', interval: 'yearly', recipient: 'erd1rec' },
    }) as any

    const credential = Credential.from({
      challenge,
      payload: { txHash: '0xabc', sender: 'erd1sender' },
    })

    try {
      await subscriptionMethod.verify({
        credential,
        request: { amount: '500', currency: 'EGLD', interval: 'yearly', recipient: 'erd1rec' },
      })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(Errors.VerificationFailedError)
      expect(e.message).toContain('Amount mismatch')
    }
  })
})
