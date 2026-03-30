import {
  Address,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  Transaction,
  TransactionsFactoryConfig,
} from '@multiversx/sdk-core'
import { BigUIntValue, TokenIdentifierValue } from '@multiversx/sdk-core'
import type {
  IAccount,
  INetworkProvider,
  TransactionOnNetwork,
} from '@multiversx/sdk-core'

export type SwapPlanTransactionTemplate = {
  kind: 'smart-contract-execute'
  chainId: string
  receiver: string
  gasLimit: string
  function: string
  nativeTransferAmount?: string
  tokenTransfers?: Array<{
    token: string
    nonce?: number
    amount?: string
    amountSource?: {
      kind: 'previous-action-output'
      actionIndex: number
      outputToken: string
      fallbackAmount: string
    }
  }>
  arguments?: Array<
    | { type: 'TokenIdentifier'; value: string }
    | { type: 'BigUInt'; value: string }
  >
}

export type SwapPlanAction = {
  type: string
  tokenIn?: string
  tokenOut?: string
  transactionTemplate?: SwapPlanTransactionTemplate
}

export type SwapExecutionPlan = {
  chainId?: string
  actions: SwapPlanAction[]
}

export type BuildSwapPlanTransactionsParameters = {
  sender: string | Address
  plan: SwapExecutionPlan
  minGasLimit?: bigint
  gasLimitPerByte?: bigint
  ignoreUnsupportedActions?: boolean
  actionOutputs?: Record<
    number,
    {
      token?: string
      amount: string
    }
  >
}

export type BuildSwapPlanActionTransactionParameters = Omit<
  BuildSwapPlanTransactionsParameters,
  'plan'
> & {
  action: SwapPlanAction
  actionIndex: number
  chainId?: string
}

export type ExecuteSwapPlanParameters = Omit<
  BuildSwapPlanTransactionsParameters,
  'sender'
> & {
  signer: IAccount
  provider: Pick<INetworkProvider, 'getAccount' | 'sendTransaction' | 'getTransaction'>
  completionTimeoutMs?: number
  pollIntervalMs?: number
}

export type SwapPlanActionOutput = {
  token?: string
  amount: string
}

export type ExecutedSwapPlanAction = {
  actionIndex: number
  actionType: string
  txHash: string
  transaction: Transaction
  completedTransaction: TransactionOnNetwork
  output?: SwapPlanActionOutput
}

export async function buildTransactionsFromSwapPlan(
  parameters: BuildSwapPlanTransactionsParameters,
): Promise<Transaction[]> {
  const sender =
    typeof parameters.sender === 'string'
      ? Address.newFromBech32(parameters.sender)
      : parameters.sender
  const transactions: Transaction[] = []

  for (const [actionIndex, action] of parameters.plan.actions.entries()) {
    const transactionParameters: BuildSwapPlanActionTransactionParameters = {
      sender,
      action,
      actionIndex,
      ...(parameters.plan.chainId ? { chainId: parameters.plan.chainId } : {}),
      ...(parameters.minGasLimit !== undefined
        ? { minGasLimit: parameters.minGasLimit }
        : {}),
      ...(parameters.gasLimitPerByte !== undefined
        ? { gasLimitPerByte: parameters.gasLimitPerByte }
        : {}),
      ...(parameters.ignoreUnsupportedActions !== undefined
        ? { ignoreUnsupportedActions: parameters.ignoreUnsupportedActions }
        : {}),
      ...(parameters.actionOutputs ? { actionOutputs: parameters.actionOutputs } : {}),
    }
    const transaction = await buildTransactionFromSwapPlanAction(transactionParameters)

    if (transaction) {
      transactions.push(transaction)
    }
  }

  return transactions
}

export async function buildTransactionFromSwapPlanAction(
  parameters: BuildSwapPlanActionTransactionParameters,
): Promise<Transaction | undefined> {
  const sender =
    typeof parameters.sender === 'string'
      ? Address.newFromBech32(parameters.sender)
      : parameters.sender
  const template = parameters.action.transactionTemplate

  if (!template) {
    if (parameters.ignoreUnsupportedActions) {
      return undefined
    }

    throw new Error(
      `Unsupported swap plan action without template at index ${parameters.actionIndex}: ${parameters.action.type}`,
    )
  }

  const txConfig = new TransactionsFactoryConfig({
    chainID: template.chainId || parameters.chainId || 'D',
  })

  if (parameters.minGasLimit !== undefined) {
    txConfig.minGasLimit = parameters.minGasLimit
  }

  if (parameters.gasLimitPerByte !== undefined) {
    txConfig.gasLimitPerByte = parameters.gasLimitPerByte
  }

  const factory = new SmartContractTransactionsFactory({
    config: txConfig,
  })

  return factory.createTransactionForExecute(sender, {
    contract: Address.newFromBech32(template.receiver),
    gasLimit: BigInt(template.gasLimit),
    function: template.function,
    arguments: (template.arguments || []).map((argument) => {
      if (argument.type === 'TokenIdentifier') {
        return new TokenIdentifierValue(argument.value)
      }

      return new BigUIntValue(BigInt(argument.value))
    }),
    ...(template.nativeTransferAmount
      ? { nativeTransferAmount: BigInt(template.nativeTransferAmount) }
      : {}),
    ...(template.tokenTransfers
      ? {
          tokenTransfers: template.tokenTransfers.map(
            (transfer, transferIndex) =>
              new TokenTransfer({
                token: new Token({
                  identifier: transfer.token,
                  ...(transfer.nonce ? { nonce: BigInt(transfer.nonce) } : {}),
                }),
                amount: BigInt(
                  resolveTemplateAmount({
                    actionOutputs: parameters.actionOutputs,
                    amount: transfer.amount,
                    amountSource: transfer.amountSource,
                    location: `action ${parameters.actionIndex} tokenTransfers[${transferIndex}]`,
                  }),
                ),
              }),
          ),
        }
      : {}),
  })
}

export async function executeSwapPlan(
  parameters: ExecuteSwapPlanParameters,
): Promise<{
  actionOutputs: NonNullable<BuildSwapPlanTransactionsParameters['actionOutputs']>
  executions: ExecutedSwapPlanAction[]
}> {
  const actionOutputs = { ...(parameters.actionOutputs || {}) }
  const executions: ExecutedSwapPlanAction[] = []
  const sender = parameters.signer.address
  let nextNonce = (await parameters.provider.getAccount(sender)).nonce

  for (const [actionIndex, action] of parameters.plan.actions.entries()) {
    const transactionParameters: BuildSwapPlanActionTransactionParameters = {
      sender,
      action,
      actionIndex,
      ...(parameters.plan.chainId ? { chainId: parameters.plan.chainId } : {}),
      ...(parameters.minGasLimit !== undefined
        ? { minGasLimit: parameters.minGasLimit }
        : {}),
      ...(parameters.gasLimitPerByte !== undefined
        ? { gasLimitPerByte: parameters.gasLimitPerByte }
        : {}),
      ...(parameters.ignoreUnsupportedActions !== undefined
        ? { ignoreUnsupportedActions: parameters.ignoreUnsupportedActions }
        : {}),
      ...(Object.keys(actionOutputs).length > 0 ? { actionOutputs } : {}),
    }
    const transaction = await buildTransactionFromSwapPlanAction(transactionParameters)

    if (!transaction) {
      continue
    }

    transaction.nonce = nextNonce
    transaction.signature = await parameters.signer.signTransaction(transaction)

    const txHash = await parameters.provider.sendTransaction(transaction)
    const waitParameters = {
      provider: parameters.provider,
      txHash,
      ...(parameters.completionTimeoutMs !== undefined
        ? { timeoutMs: parameters.completionTimeoutMs }
        : {}),
      ...(parameters.pollIntervalMs !== undefined
        ? { pollIntervalMs: parameters.pollIntervalMs }
        : {}),
    }
    const completedTransaction = await waitForCompletedTransaction(waitParameters)
    const output = extractActionOutput({
      action,
      sender,
      transaction: completedTransaction,
    })

    if (output) {
      actionOutputs[actionIndex] = output
    }

    executions.push({
      actionIndex,
      actionType: action.type,
      txHash,
      transaction,
      completedTransaction,
      ...(output ? { output } : {}),
    })

    nextNonce += 1n
  }

  return {
    actionOutputs,
    executions,
  }
}

function resolveTemplateAmount(parameters: {
  actionOutputs: BuildSwapPlanTransactionsParameters['actionOutputs'] | undefined
  amount: string | undefined
  amountSource:
    | {
        kind: 'previous-action-output'
        actionIndex: number
        outputToken: string
        fallbackAmount: string
      }
    | undefined
  location: string
}): string {
  if (parameters.amount) {
    return parameters.amount
  }

  if (!parameters.amountSource) {
    throw new Error(`Missing amount for ${parameters.location}`)
  }

  const resolvedOutput = parameters.actionOutputs?.[parameters.amountSource.actionIndex]
  if (resolvedOutput) {
    if (
      resolvedOutput.token &&
      resolvedOutput.token !== parameters.amountSource.outputToken
    ) {
      throw new Error(
        `Resolved output token mismatch for ${parameters.location}: expected ${parameters.amountSource.outputToken}, received ${resolvedOutput.token}`,
      )
    }

    return resolvedOutput.amount
  }

  return parameters.amountSource.fallbackAmount
}

async function waitForCompletedTransaction(parameters: {
  provider: Pick<INetworkProvider, 'getTransaction'>
  txHash: string
  timeoutMs?: number
  pollIntervalMs?: number
}): Promise<TransactionOnNetwork> {
  const timeoutMs = parameters.timeoutMs ?? 90_000
  const pollIntervalMs = parameters.pollIntervalMs ?? 2_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const transaction = await parameters.provider.getTransaction(parameters.txHash)
    if (transaction.status.isCompleted()) {
      return transaction
    }

    await sleep(pollIntervalMs)
  }

  throw new Error(`Timed out waiting for transaction ${parameters.txHash} to complete`)
}

function extractActionOutput(parameters: {
  action: SwapPlanAction
  sender: Address
  transaction: TransactionOnNetwork
}): SwapPlanActionOutput | undefined {
  const senderBech32 = parameters.sender.toBech32()
  const expectedToken =
    parameters.action.type === 'unwrap-egld'
      ? 'EGLD'
      : parameters.action.tokenOut || undefined

  const outputs = parameters.transaction.smartContractResults
    .filter((result) => result.receiver.toBech32() === senderBech32)
    .flatMap((result) => extractResultTransfers(result.raw))

  if (outputs.length === 0) {
    return undefined
  }

  if (expectedToken) {
    const matchingOutput = [...outputs]
      .reverse()
      .find((output) => output.token === expectedToken)

    if (matchingOutput) {
      return matchingOutput
    }
  }

  return outputs[outputs.length - 1]
}

function extractResultTransfers(raw: Record<string, unknown>): SwapPlanActionOutput[] {
  const outputs: SwapPlanActionOutput[] = []
  const tokens = Array.isArray(raw.tokens)
    ? raw.tokens.filter((value): value is string => typeof value === 'string')
    : []
  const esdtValues = Array.isArray(raw.esdtValues)
    ? raw.esdtValues.filter((value): value is string => typeof value === 'string')
    : []

  tokens.forEach((token, index) => {
    const amount = esdtValues[index]
    if (amount) {
      outputs.push({ token, amount })
    }
  })

  if (outputs.length > 0) {
    return outputs
  }

  const data = typeof raw.data === 'string' ? raw.data : ''
  const parsedEsdtTransfer = parseEsdtTransferData(data)
  if (parsedEsdtTransfer) {
    outputs.push(parsedEsdtTransfer)
  }

  const value = raw.value
  if (value !== undefined && value !== null) {
    const normalizedValue = String(value)
    if (normalizedValue !== '0') {
      outputs.push({
        token: 'EGLD',
        amount: normalizedValue,
      })
    }
  }

  return outputs
}

function parseEsdtTransferData(data: string): SwapPlanActionOutput | undefined {
  if (!data.startsWith('ESDTTransfer@')) {
    return undefined
  }

  const [, tokenHex, amountHex] = data.split('@')
  if (!tokenHex || !amountHex) {
    return undefined
  }

  return {
    token: Buffer.from(tokenHex, 'hex').toString(),
    amount: BigInt(`0x${amountHex}`).toString(),
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
