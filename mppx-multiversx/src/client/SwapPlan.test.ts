import { describe, expect, it } from 'vitest'
import { buildTransactionsFromSwapPlan } from './SwapPlan.js'

describe('swap plan transaction construction', () => {
  it('builds unsigned pair swap transactions from execution plan templates', async () => {
    const [transaction] = await buildTransactionsFromSwapPlan({
      sender: 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx',
      plan: {
        chainId: 'D',
        actions: [
          {
            type: 'swap-fixed-input',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq',
              gasLimit: '100000000',
              function: 'swapTokensFixedInput',
              tokenTransfers: [
                {
                  token: 'USDC-c76f1f',
                  nonce: 0,
                  amount: '25000000',
                },
              ],
              arguments: [
                {
                  type: 'TokenIdentifier',
                  value: 'WEGLD-bd4d79',
                },
                {
                  type: 'BigUInt',
                  value: '6456540000000000000',
                },
              ],
            },
          },
        ],
      },
    })

    expect(transaction.receiver.toBech32()).toBe(
      'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq',
    )
    expect(transaction.chainID).toBe('D')
    expect(transaction.gasLimit).toBe(100000000n)
    expect(Buffer.from(transaction.data).toString()).toContain(
      Buffer.from('swapTokensFixedInput').toString('hex'),
    )
    expect(Buffer.from(transaction.data).toString()).toContain(
      Buffer.from('WEGLD-bd4d79').toString('hex'),
    )
  })

  it('builds unsigned native-transfer execute transactions for wrap-egld actions', async () => {
    const [transaction] = await buildTransactionsFromSwapPlan({
      sender: 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx',
      plan: {
        chainId: 'D',
        actions: [
          {
            type: 'wrap-egld',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
              gasLimit: '10000000',
              function: 'wrapEgld',
              nativeTransferAmount: '2000000000000000000',
              tokenTransfers: [],
              arguments: [],
            },
          },
        ],
      },
    })

    expect(transaction.receiver.toBech32()).toBe(
      'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
    )
    expect(transaction.chainID).toBe('D')
    expect(transaction.gasLimit).toBe(10000000n)
    expect(transaction.value).toBe(2000000000000000000n)
    expect(Buffer.from(transaction.data).toString()).toBe('wrapEgld')
  })
})
