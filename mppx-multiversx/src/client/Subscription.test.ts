import { describe, expect, it, vi } from 'vitest'
import { subscription } from './Subscription.js'
import { Challenge, Credential } from 'mppx'

describe('client subscription intent', () => {
  it('should format and return credential with currency and interval', async () => {
    const mockSignAndSend = vi.fn().mockResolvedValue({
      txHash: '0x123',
      sender: 'erd1sender',
    })

    const subscriptionMethod = subscription({
      signAndSendTransaction: mockSignAndSend,
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx' as const,
      intent: 'subscription' as const,
      request: {
        amount: '1000',
        currency: 'EGLD',
        interval: 'monthly',
        recipient: 'erd1rec',
        methodDetails: { chainId: 'D', decimals: 18 },
      },
    }) as any

    const serializedCredential = await subscriptionMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    expect(mockSignAndSend).toHaveBeenCalledWith({
      amount: '1000',
      interval: 'monthly',
      challenge: expect.any(Object),
      currency: 'EGLD',
      chainId: 'D',
      sender: 'erd1sender',
      recipient: 'erd1rec',
    })

    const credential = Credential.deserialize<{ txHash: string; sender: string }>(serializedCredential as string)
    expect(credential.payload).toEqual({
      txHash: '0x123',
      sender: 'erd1sender',
    })
  })

  it('should include externalId in credential when provided', async () => {
    const mockSignAndSend = vi.fn().mockResolvedValue({
      txHash: '0xabc',
      sender: 'erd1sender',
    })

    const subscriptionMethod = subscription({
      signAndSendTransaction: mockSignAndSend,
      externalId: 'subscription-42',
    })

    const challenge = Challenge.from({
      id: 'xyz',
      realm: 'example',
      method: 'multiversx',
      intent: 'subscription',
      request: {
        amount: '500',
        currency: 'USDC-c76f31',
        interval: 'yearly',
        recipient: 'erd1rec',
        methodDetails: { chainId: '1', decimals: 6 },
      },
    }) as any

    const serializedCredential = await subscriptionMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    const credential = Credential.deserialize<{
      txHash: string
      sender: string
      externalId?: string
    }>(serializedCredential as string)

    expect(credential.payload.externalId).toBe('subscription-42')
    expect(credential.payload.txHash).toBe('0xabc')
  })
})
