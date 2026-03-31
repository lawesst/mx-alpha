import { Address, TransactionOnNetwork, TransactionStatus } from '@multiversx/sdk-core'
import { describe, expect, it } from 'vitest'
import {
  SwapPlanExecutionError,
  SwapPlanPolicyError,
  buildTransactionsFromSwapPlan,
  executeSwapPlan,
  simulateSwapPlan,
  SwapPlanSimulationError,
} from './SwapPlan.js'

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

  it('uses fallback previous-output amounts for chained swap actions', async () => {
    const [, chainedTransaction] = await buildTransactionsFromSwapPlan({
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
          {
            type: 'swap-fixed-input',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgqav09xenkuqsdyeyy5evqyhuusvu4gl3t2jpss57g8x',
              gasLimit: '100000000',
              function: 'swapTokensFixedInput',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '6000000000000000000',
                  },
                },
              ],
              arguments: [
                {
                  type: 'TokenIdentifier',
                  value: 'RIDE-7d18e9',
                },
                {
                  type: 'BigUInt',
                  value: '1200000000000000000000',
                },
              ],
            },
          },
        ],
      },
    })

    expect(Buffer.from(chainedTransaction.data).toString()).toContain(
      'ESDTTransfer@5745474c442d626434643739@53444835ec580000',
    )
  })

  it('prefers resolved previous-output amounts when provided', async () => {
    const [, chainedTransaction] = await buildTransactionsFromSwapPlan({
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
          {
            type: 'swap-fixed-input',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgqav09xenkuqsdyeyy5evqyhuusvu4gl3t2jpss57g8x',
              gasLimit: '100000000',
              function: 'swapTokensFixedInput',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '6000000000000000000',
                  },
                },
              ],
              arguments: [
                {
                  type: 'TokenIdentifier',
                  value: 'RIDE-7d18e9',
                },
                {
                  type: 'BigUInt',
                  value: '1200000000000000000000',
                },
              ],
            },
          },
        ],
      },
      actionOutputs: {
        0: {
          token: 'WEGLD-bd4d79',
          amount: '7000000000000000000',
        },
      },
    })

    expect(Buffer.from(chainedTransaction.data).toString()).toContain(
      'ESDTTransfer@5745474c442d626434643739@6124fee993bc0000',
    )
  })

  it('rejects plans that violate execution policy metadata guards', async () => {
    await expect(
      buildTransactionsFromSwapPlan({
        sender: 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx',
        plan: {
          chainId: 'D',
          strategy: 'advisory-only',
          slippageBpsSuggested: 1800,
          deadlineSecondsSuggested: 1200,
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
            {
              type: 'unwrap-egld',
              tokenOut: 'EGLD',
              transactionTemplate: {
                kind: 'smart-contract-execute',
                chainId: 'D',
                receiver:
                  'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
                gasLimit: '10000000',
                function: 'unwrapEgld',
                tokenTransfers: [
                  {
                    token: 'WEGLD-bd4d79',
                    nonce: 0,
                    amount: '2000000000000000000',
                  },
                ],
                arguments: [],
              },
            },
          ],
        },
        executionPolicy: {
          maxActionCount: 1,
          allowedStrategies: ['xexchange-pair-sequence'],
          allowedActionTypes: ['wrap-egld', 'swap-fixed-input'],
          maxSuggestedSlippageBps: 1500,
          maxSuggestedDeadlineSeconds: 900,
        },
      }),
    ).rejects.toMatchObject({
      name: 'SwapPlanPolicyError',
      violations: expect.arrayContaining([
        expect.stringContaining('exceeds the policy maximum of 1'),
        expect.stringContaining('strategy "advisory-only"'),
        expect.stringContaining('slippage 1800bps'),
        expect.stringContaining('deadline 1200s'),
        expect.stringContaining('type "unwrap-egld"'),
      ]),
    })
  })

  it('executes swap-plan actions sequentially and feeds actual outputs into later actions', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: { nonce: bigint; data: string }[] = []

    const result = await executeSwapPlan({
      signer: {
        address: signerAddress,
        sign: async () => new Uint8Array(),
        signTransaction: async () => new Uint8Array([1, 2, 3]),
        verifyTransactionSignature: async () => true,
        signMessage: async () => new Uint8Array(),
        verifyMessageSignature: async () => true,
      },
      provider: {
        getAccount: async () => ({ nonce: 7n }),
        sendTransaction: async (transaction) => {
          sentTransactions.push({
            nonce: transaction.nonce,
            data: Buffer.from(transaction.data).toString(),
          })

          return `tx-${sentTransactions.length}`
        },
        getTransaction: async (txHash) => {
          if (txHash === 'tx-1') {
            return new TransactionOnNetwork({
              hash: txHash,
              status: new TransactionStatus('success'),
              smartContractResults: [
                {
                  receiver: signerAddress,
                  raw: {
                    tokens: ['WEGLD-bd4d79'],
                    esdtValues: ['2100000000000000000'],
                  },
                } as never,
              ],
            })
          }

          return new TransactionOnNetwork({
            hash: txHash,
            status: new TransactionStatus('success'),
            smartContractResults: [
              {
                receiver: signerAddress,
                raw: {
                  value: '2100000000000000000',
                },
              } as never,
            ],
          })
        },
      },
      plan: {
        chainId: 'D',
        actions: [
          {
            type: 'wrap-egld',
            tokenOut: 'WEGLD-bd4d79',
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
          {
            type: 'unwrap-egld',
            tokenOut: 'EGLD',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
              gasLimit: '10000000',
              function: 'unwrapEgld',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '2000000000000000000',
                  },
                },
              ],
              arguments: [],
            },
          },
        ],
      },
    })

    expect(sentTransactions[0].nonce).toBe(7n)
    expect(sentTransactions[1].nonce).toBe(8n)
    expect(sentTransactions[1].data).toContain(
      `ESDTTransfer@5745474c442d626434643739@${BigInt('2100000000000000000').toString(16)}`,
    )
    expect(result.actionOutputs[0]).toEqual({
      token: 'WEGLD-bd4d79',
      amount: '2100000000000000000',
    })
    expect(result.executions).toHaveLength(2)
    expect(result.executions[0].status).toBe('success')
    expect(result.executions[1].status).toBe('success')
  })

  it('rejects disallowed receivers before broadcasting any transaction', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: string[] = []

    try {
      await executeSwapPlan({
        signer: {
          address: signerAddress,
          sign: async () => new Uint8Array(),
          signTransaction: async () => new Uint8Array([1, 2, 3]),
          verifyTransactionSignature: async () => true,
          signMessage: async () => new Uint8Array(),
          verifyMessageSignature: async () => true,
        },
        provider: {
          getAccount: async () => ({ nonce: 5n }),
          sendTransaction: async (transaction) => {
            sentTransactions.push(Buffer.from(transaction.data).toString())
            return `tx-${sentTransactions.length}`
          },
          getTransaction: async (txHash) =>
            new TransactionOnNetwork({
              hash: txHash,
              status: new TransactionStatus('success'),
              smartContractResults: [],
            }),
        },
        plan: {
          chainId: 'D',
          strategy: 'xexchange-pair-sequence',
          actions: [
            {
              type: 'swap-fixed-input',
              tokenOut: 'WEGLD-bd4d79',
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
        executionPolicy: {
          allowedStrategies: ['xexchange-pair-sequence'],
          allowedReceivers: [
            'erd1qqqqqqqqqqqqqpgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqf4la8',
          ],
        },
      })
    } catch (error) {
      expect(error).toBeInstanceOf(SwapPlanPolicyError)
      expect(error).toMatchObject({
        violations: [
          expect.stringContaining('not in the allowed receiver list'),
        ],
      })
      expect(sentTransactions).toHaveLength(0)
      return
    }

    throw new Error('Expected executeSwapPlan() to throw a SwapPlanPolicyError')
  })

  it('simulates swap-plan actions sequentially and uses simulated outputs for later hops', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const senderAddress = Address.newFromBech32(sender)
    const simulatedTransactions: { nonce: bigint; data: string }[] = []

    const result = await simulateSwapPlan({
      sender,
      provider: {
        getAccount: async () => ({ nonce: 11n }),
        simulateTransaction: async (transaction) => {
          simulatedTransactions.push({
            nonce: transaction.nonce,
            data: Buffer.from(transaction.data).toString(),
          })

          if (simulatedTransactions.length === 1) {
            return new TransactionOnNetwork({
              hash: 'sim-1',
              status: new TransactionStatus('success'),
              smartContractResults: [
                {
                  receiver: senderAddress,
                  raw: {
                    tokens: ['WEGLD-bd4d79'],
                    esdtValues: ['2300000000000000000'],
                  },
                } as never,
              ],
            })
          }

          return new TransactionOnNetwork({
            hash: 'sim-2',
            status: new TransactionStatus('success'),
            smartContractResults: [
              {
                receiver: senderAddress,
                raw: {
                  value: '2300000000000000000',
                },
              } as never,
            ],
          })
        },
      },
      plan: {
        chainId: 'D',
        actions: [
          {
            type: 'wrap-egld',
            tokenOut: 'WEGLD-bd4d79',
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
          {
            type: 'unwrap-egld',
            tokenOut: 'EGLD',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
              gasLimit: '10000000',
              function: 'unwrapEgld',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '2000000000000000000',
                  },
                },
              ],
              arguments: [],
            },
          },
        ],
      },
      ignoreUnsupportedActions: true,
    })

    expect(simulatedTransactions[0].nonce).toBe(11n)
    expect(simulatedTransactions[1].nonce).toBe(12n)
    expect(simulatedTransactions[1].data).toContain(
      `ESDTTransfer@5745474c442d626434643739@${BigInt('2300000000000000000').toString(16)}`,
    )
    expect(result.actionOutputs[0]).toEqual({
      token: 'WEGLD-bd4d79',
      amount: '2300000000000000000',
    })
    expect(result.simulations[0].status).toBe('success')
    expect(result.simulations[1].status).toBe('success')
  })

  it('throws a structured simulation error when dry-run fails', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'

    try {
      await simulateSwapPlan({
        sender,
        provider: {
          getAccount: async () => ({ nonce: 4n }),
          simulateTransaction: async () =>
            new TransactionOnNetwork({
              hash: 'sim-fail',
              status: new TransactionStatus('fail'),
              smartContractResults: [],
              raw: {
                reason: 'simulation slippage exceeded',
              },
            }),
        },
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
    } catch (error) {
      expect(error).toBeInstanceOf(SwapPlanSimulationError)
      expect(error).toMatchObject({
        failedSimulation: {
          actionIndex: 0,
          actionType: 'swap-fixed-input',
          status: 'fail',
          failureReason: 'simulation slippage exceeded',
        },
        simulations: [
          expect.objectContaining({
            actionIndex: 0,
            status: 'fail',
          }),
        ],
      })
      return
    }

    throw new Error('Expected simulateSwapPlan() to throw a SwapPlanSimulationError')
  })

  it('blocks broadcast when pre-broadcast simulation fails', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: string[] = []

    try {
      await executeSwapPlan({
        signer: {
          address: signerAddress,
          sign: async () => new Uint8Array(),
          signTransaction: async () => new Uint8Array([1, 2, 3]),
          verifyTransactionSignature: async () => true,
          signMessage: async () => new Uint8Array(),
          verifyMessageSignature: async () => true,
        },
        provider: {
          getAccount: async () => ({ nonce: 6n }),
          sendTransaction: async (transaction) => {
            sentTransactions.push(Buffer.from(transaction.data).toString())
            return `tx-${sentTransactions.length}`
          },
          getTransaction: async (txHash) =>
            new TransactionOnNetwork({
              hash: txHash,
              status: new TransactionStatus('success'),
              smartContractResults: [],
            }),
          simulateTransaction: async () =>
            new TransactionOnNetwork({
              hash: 'sim-fail',
              status: new TransactionStatus('fail'),
              smartContractResults: [],
              raw: {
                reason: 'pair contract would reject the route',
              },
            }),
        },
        plan: {
          chainId: 'D',
          strategy: 'xexchange-pair-sequence',
          actions: [
            {
              type: 'swap-fixed-input',
              tokenOut: 'WEGLD-bd4d79',
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
        simulateBeforeBroadcast: true,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(SwapPlanSimulationError)
      expect(error).toMatchObject({
        failedSimulation: {
          status: 'fail',
          failureReason: 'pair contract would reject the route',
        },
      })
      expect(sentTransactions).toHaveLength(0)
      return
    }

    throw new Error('Expected executeSwapPlan() to throw a SwapPlanSimulationError')
  })

  it('returns pre-broadcast simulations and output comparisons when execution succeeds', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: { nonce: bigint; data: string }[] = []

    const result = await executeSwapPlan({
      signer: {
        address: signerAddress,
        sign: async () => new Uint8Array(),
        signTransaction: async () => new Uint8Array([1, 2, 3]),
        verifyTransactionSignature: async () => true,
        signMessage: async () => new Uint8Array(),
        verifyMessageSignature: async () => true,
      },
      provider: {
        getAccount: async () => ({ nonce: 13n }),
        sendTransaction: async (transaction) => {
          sentTransactions.push({
            nonce: transaction.nonce,
            data: Buffer.from(transaction.data).toString(),
          })
          return `tx-${sentTransactions.length}`
        },
        getTransaction: async (txHash) => {
          if (txHash === 'tx-1') {
            return new TransactionOnNetwork({
              hash: txHash,
              status: new TransactionStatus('success'),
              smartContractResults: [
                {
                  receiver: signerAddress,
                  raw: {
                    tokens: ['WEGLD-bd4d79'],
                    esdtValues: ['2100000000000000000'],
                  },
                } as never,
              ],
            })
          }

          return new TransactionOnNetwork({
            hash: txHash,
            status: new TransactionStatus('success'),
            smartContractResults: [
              {
                receiver: signerAddress,
                raw: {
                  value: '2100000000000000000',
                },
              } as never,
            ],
          })
        },
        simulateTransaction: async (transaction) => {
          if (transaction.nonce === 13n) {
            return new TransactionOnNetwork({
              hash: 'sim-1',
              status: new TransactionStatus('success'),
              smartContractResults: [
                {
                  receiver: signerAddress,
                  raw: {
                    tokens: ['WEGLD-bd4d79'],
                    esdtValues: ['2000000000000000000'],
                  },
                } as never,
              ],
            })
          }

          return new TransactionOnNetwork({
            hash: 'sim-2',
            status: new TransactionStatus('success'),
            smartContractResults: [
              {
                receiver: signerAddress,
                raw: {
                  value: '2000000000000000000',
                },
              } as never,
            ],
          })
        },
      },
      plan: {
        chainId: 'D',
        strategy: 'xexchange-pair-sequence',
        actions: [
          {
            type: 'wrap-egld',
            tokenOut: 'WEGLD-bd4d79',
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
          {
            type: 'unwrap-egld',
            tokenOut: 'EGLD',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
              gasLimit: '10000000',
              function: 'unwrapEgld',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '2000000000000000000',
                  },
                },
              ],
              arguments: [],
            },
          },
        ],
      },
      simulateBeforeBroadcast: true,
    })

    expect(sentTransactions[0].nonce).toBe(13n)
    expect(sentTransactions[1].nonce).toBe(14n)
    expect(result.simulations).toHaveLength(2)
    expect(result.executions[0].preBroadcastSimulation).toMatchObject({
      status: 'success',
      output: {
        token: 'WEGLD-bd4d79',
        amount: '2000000000000000000',
      },
    })
    expect(result.executions[0].outputComparison).toEqual({
      simulatedToken: 'WEGLD-bd4d79',
      actualToken: 'WEGLD-bd4d79',
      simulatedAmount: '2000000000000000000',
      actualAmount: '2100000000000000000',
      deltaAmount: '100000000000000000',
      absoluteDeltaAmount: '100000000000000000',
    })
    expect(result.executions[1].outputComparison).toEqual({
      simulatedToken: 'EGLD',
      actualToken: 'EGLD',
      actualAmount: '2100000000000000000',
      simulatedAmount: '2000000000000000000',
      deltaAmount: '100000000000000000',
      absoluteDeltaAmount: '100000000000000000',
    })
  })

  it('falls back to embedded amounts when execution outputs are unavailable', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: string[] = []

    await executeSwapPlan({
      signer: {
        address: signerAddress,
        sign: async () => new Uint8Array(),
        signTransaction: async () => new Uint8Array([1, 2, 3]),
        verifyTransactionSignature: async () => true,
        signMessage: async () => new Uint8Array(),
        verifyMessageSignature: async () => true,
      },
      provider: {
        getAccount: async () => ({ nonce: 3n }),
        sendTransaction: async (transaction) => {
          sentTransactions.push(Buffer.from(transaction.data).toString())
          return `tx-${sentTransactions.length}`
        },
        getTransaction: async (txHash) =>
          new TransactionOnNetwork({
            hash: txHash,
            status: new TransactionStatus('success'),
            smartContractResults: [],
          }),
      },
      plan: {
        chainId: 'D',
        actions: [
          {
            type: 'wrap-egld',
            tokenOut: 'WEGLD-bd4d79',
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
          {
            type: 'unwrap-egld',
            tokenOut: 'EGLD',
            transactionTemplate: {
              kind: 'smart-contract-execute',
              chainId: 'D',
              receiver:
                'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
              gasLimit: '10000000',
              function: 'unwrapEgld',
              tokenTransfers: [
                {
                  token: 'WEGLD-bd4d79',
                  nonce: 0,
                  amountSource: {
                    kind: 'previous-action-output',
                    actionIndex: 0,
                    outputToken: 'WEGLD-bd4d79',
                    fallbackAmount: '2000000000000000000',
                  },
                },
              ],
              arguments: [],
            },
          },
        ],
      },
    })

    expect(sentTransactions[1]).toContain(
      `ESDTTransfer@5745474c442d626434643739@${BigInt('2000000000000000000').toString(16)}`,
    )
  })

  it('throws a structured execution error when a step completes unsuccessfully', async () => {
    const sender = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx'
    const signerAddress = Address.newFromBech32(sender)
    const sentTransactions: string[] = []
    try {
      await executeSwapPlan({
        signer: {
          address: signerAddress,
          sign: async () => new Uint8Array(),
          signTransaction: async () => new Uint8Array([1, 2, 3]),
          verifyTransactionSignature: async () => true,
          signMessage: async () => new Uint8Array(),
          verifyMessageSignature: async () => true,
        },
        provider: {
          getAccount: async () => ({ nonce: 9n }),
          sendTransaction: async (transaction) => {
            sentTransactions.push(Buffer.from(transaction.data).toString())
            return `tx-${sentTransactions.length}`
          },
          getTransaction: async (txHash) =>
            new TransactionOnNetwork({
              hash: txHash,
              status: new TransactionStatus('fail'),
              smartContractResults: [],
              raw: {
                reason: 'insufficient output amount',
              },
            }),
        },
        plan: {
          chainId: 'D',
          actions: [
            {
              type: 'swap-fixed-input',
              tokenOut: 'WEGLD-bd4d79',
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
            {
              type: 'unwrap-egld',
              tokenOut: 'EGLD',
              transactionTemplate: {
                kind: 'smart-contract-execute',
                chainId: 'D',
                receiver:
                  'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
                gasLimit: '10000000',
                function: 'unwrapEgld',
                tokenTransfers: [
                  {
                    token: 'WEGLD-bd4d79',
                    nonce: 0,
                    amountSource: {
                      kind: 'previous-action-output',
                      actionIndex: 0,
                      outputToken: 'WEGLD-bd4d79',
                      fallbackAmount: '2000000000000000000',
                    },
                  },
                ],
                arguments: [],
              },
            },
          ],
        },
      })
    } catch (error) {
      expect(error).toBeInstanceOf(SwapPlanExecutionError)
      expect(error).toMatchObject({
        failedExecution: {
          actionIndex: 0,
          actionType: 'swap-fixed-input',
          status: 'fail',
          failureReason: 'insufficient output amount',
        },
        executions: [
          expect.objectContaining({
            actionIndex: 0,
            status: 'fail',
          }),
        ],
        actionOutputs: {},
      })
      expect(sentTransactions).toHaveLength(1)
      return
    }

    throw new Error('Expected executeSwapPlan() to throw')
  })
})
