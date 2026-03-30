import { describe, expect, it, vi } from 'vitest'
import { session } from './Session.js'
import { Challenge, Credential } from 'mppx'

describe('client session intent', () => {
  it('should format and return credential with currency and duration', async () => {
    const mockSignAndSend = vi.fn().mockResolvedValue({
      txHash: '0x123',
      sender: 'erd1sender',
    })

    const sessionMethod = session({
      signAndSendTransaction: mockSignAndSend,
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx' as const,
      intent: 'session' as const,
      request: {
        amount: '1000',
        currency: 'EGLD',
        duration: '3600',
        recipient: 'erd1rec',
        methodDetails: { chainId: 'D', decimals: 18 },
      },
    })

    const serializedCredential = await sessionMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    expect(mockSignAndSend).toHaveBeenCalledWith({
      amount: '1000',
      duration: '3600',
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

    const sessionMethod = session({
      signAndSendTransaction: mockSignAndSend,
      externalId: 'session-42',
    })

    const challenge = Challenge.from({
      id: 'xyz',
      realm: 'example',
      method: 'multiversx',
      intent: 'session',
      request: {
        amount: '500',
        currency: 'USDC-c76f31',
        duration: '7200',
        recipient: 'erd1rec',
        methodDetails: { chainId: '1', decimals: 6 },
      },
    })

    const serializedCredential = await sessionMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    const credential = Credential.deserialize<{
      txHash: string
      sender: string
      externalId?: string
    }>(serializedCredential as string)

    expect(credential.payload.externalId).toBe('session-42')
    expect(credential.payload.txHash).toBe('0xabc')
  })
})
