import { describe, expect, it, vi } from 'vitest'
import { charge } from './Charge.js'
import { Challenge, Credential } from 'mppx'

describe('client charge intent', () => {
  it('should format and return credential with currency', async () => {
    const mockSignAndSend = vi.fn().mockResolvedValue({
      txHash: '0x123',
      sender: 'erd1sender',
    })

    const chargeMethod = charge({
      signAndSendTransaction: mockSignAndSend,
    })

    const challenge = Challenge.from({
      id: 'abc',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: {
        amount: '1000',
        currency: 'EGLD',
        recipient: 'erd1rec',
        methodDetails: { chainId: 'D', decimals: 18 },
      },
    })

    const serializedCredential = await chargeMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    expect(mockSignAndSend).toHaveBeenCalledWith({
      amount: '1000',
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

    const chargeMethod = charge({
      signAndSendTransaction: mockSignAndSend,
      externalId: 'order-42',
    })

    const challenge = Challenge.from({
      id: 'xyz',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: {
        amount: '500',
        currency: 'USDC-c76f31',
        recipient: 'erd1rec',
        methodDetails: { chainId: '1', decimals: 6 },
      },
    })

    const serializedCredential = await chargeMethod.createCredential({
      challenge,
      context: { sender: 'erd1sender' },
    })

    const credential = Credential.deserialize<{
      txHash: string
      sender: string
      externalId?: string
    }>(serializedCredential as string)

    expect(credential.payload.externalId).toBe('order-42')
    expect(credential.payload.txHash).toBe('0xabc')
  })

  it('should read currency from top-level request (not methodDetails)', async () => {
    const mockSignAndSend = vi.fn().mockResolvedValue({
      txHash: '0x999',
      sender: 'erd1test',
    })

    const chargeMethod = charge({
      signAndSendTransaction: mockSignAndSend,
    })

    const challenge = Challenge.from({
      id: 'test-id',
      realm: 'example',
      method: 'multiversx',
      intent: 'charge',
      request: {
        amount: '2000',
        currency: 'WEGLD-bd4d79',
        recipient: 'erd1target',
        methodDetails: { chainId: 'T', decimals: 18 },
      },
    })

    await chargeMethod.createCredential({
      challenge,
      context: { sender: 'erd1test' },
    })

    expect(mockSignAndSend).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'WEGLD-bd4d79',
      }),
    )
  })
})
