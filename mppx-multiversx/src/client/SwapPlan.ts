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
  strategy?: string
  slippageBpsSuggested?: number
  deadlineSecondsSuggested?: number
  warnings?: string[]
  actions: SwapPlanAction[]
}

export type SwapPlanExecutionPolicy = {
  maxActionCount?: number
  allowedActionTypes?: string[]
  allowedReceivers?: string[]
  allowedChainIds?: string[]
  allowedStrategies?: string[]
  maxSuggestedSlippageBps?: number
  maxSuggestedDeadlineSeconds?: number
}

export type BuildSwapPlanTransactionsParameters = {
  sender: string | Address
  plan: SwapExecutionPlan
  minGasLimit?: bigint
  gasLimitPerByte?: bigint
  ignoreUnsupportedActions?: boolean
  executionPolicy?: SwapPlanExecutionPolicy
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
  'plan' | 'executionPolicy'
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
  simulationProvider?: Pick<INetworkProvider, 'simulateTransaction'>
  simulateBeforeBroadcast?: boolean
  completionTimeoutMs?: number
  pollIntervalMs?: number
}

export type SwapPlanActionOutput = {
  token?: string
  amount: string
}

export type SimulatedSwapPlanAction = {
  actionIndex: number
  actionType: string
  transaction: Transaction
  simulatedTransaction: TransactionOnNetwork
  status: string
  output?: SwapPlanActionOutput
  failureReason?: string
}

export type ExecutedSwapPlanAction = {
  actionIndex: number
  actionType: string
  txHash: string
  transaction: Transaction
  completedTransaction: TransactionOnNetwork
  status: string
  output?: SwapPlanActionOutput
  failureReason?: string
}

export type ExecuteSwapPlanResult = {
  actionOutputs: NonNullable<BuildSwapPlanTransactionsParameters['actionOutputs']>
  executions: ExecutedSwapPlanAction[]
}

export type SimulateSwapPlanParameters = BuildSwapPlanTransactionsParameters & {
  provider: Pick<INetworkProvider, 'getAccount' | 'simulateTransaction'>
}

export type SimulateSwapPlanResult = {
  actionOutputs: NonNullable<BuildSwapPlanTransactionsParameters['actionOutputs']>
  simulations: SimulatedSwapPlanAction[]
}

export class SwapPlanExecutionError extends Error {
  readonly actionOutputs: ExecuteSwapPlanResult['actionOutputs']
  readonly executions: ExecutedSwapPlanAction[]
  readonly failedExecution: ExecutedSwapPlanAction

  constructor(parameters: {
    actionOutputs: ExecuteSwapPlanResult['actionOutputs']
    executions: ExecutedSwapPlanAction[]
    failedExecution: ExecutedSwapPlanAction
  }) {
    const status = parameters.failedExecution.status
    const failureReason = parameters.failedExecution.failureReason

    super(
      failureReason
        ? `Swap plan action ${parameters.failedExecution.actionIndex} (${parameters.failedExecution.actionType}) failed with status ${status}: ${failureReason}`
        : `Swap plan action ${parameters.failedExecution.actionIndex} (${parameters.failedExecution.actionType}) failed with status ${status}`,
    )

    this.name = 'SwapPlanExecutionError'
    this.actionOutputs = parameters.actionOutputs
    this.executions = parameters.executions
    this.failedExecution = parameters.failedExecution
  }
}

export class SwapPlanSimulationError extends Error {
  readonly actionOutputs: SimulateSwapPlanResult['actionOutputs']
  readonly simulations: SimulatedSwapPlanAction[]
  readonly failedSimulation: SimulatedSwapPlanAction

  constructor(parameters: {
    actionOutputs: SimulateSwapPlanResult['actionOutputs']
    simulations: SimulatedSwapPlanAction[]
    failedSimulation: SimulatedSwapPlanAction
  }) {
    const status = parameters.failedSimulation.status
    const failureReason = parameters.failedSimulation.failureReason

    super(
      failureReason
        ? `Swap plan simulation for action ${parameters.failedSimulation.actionIndex} (${parameters.failedSimulation.actionType}) failed with status ${status}: ${failureReason}`
        : `Swap plan simulation for action ${parameters.failedSimulation.actionIndex} (${parameters.failedSimulation.actionType}) failed with status ${status}`,
    )

    this.name = 'SwapPlanSimulationError'
    this.actionOutputs = parameters.actionOutputs
    this.simulations = parameters.simulations
    this.failedSimulation = parameters.failedSimulation
  }
}

export class SwapPlanPolicyError extends Error {
  readonly violations: string[]
  readonly policy: SwapPlanExecutionPolicy
  readonly plan: SwapExecutionPlan

  constructor(parameters: {
    violations: string[]
    policy: SwapPlanExecutionPolicy
    plan: SwapExecutionPlan
  }) {
    super(`Swap execution policy rejected the plan: ${parameters.violations.join('; ')}`)
    this.name = 'SwapPlanPolicyError'
    this.violations = parameters.violations
    this.policy = parameters.policy
    this.plan = parameters.plan
  }
}

export function validateSwapExecutionPlan(parameters: {
  plan: SwapExecutionPlan
  policy: SwapPlanExecutionPolicy
  ignoreUnsupportedActions?: boolean
}): void {
  const { plan, policy } = parameters
  const violations: string[] = []

  if (
    policy.maxActionCount !== undefined &&
    plan.actions.length > policy.maxActionCount
  ) {
    violations.push(
      `Plan contains ${plan.actions.length} actions, which exceeds the policy maximum of ${policy.maxActionCount}`,
    )
  }

  if (policy.allowedStrategies) {
    if (!plan.strategy) {
      violations.push('Plan strategy is missing but the policy requires an allowed strategy')
    } else if (!policy.allowedStrategies.includes(plan.strategy)) {
      violations.push(
        `Plan strategy "${plan.strategy}" is not in the allowed strategy list (${policy.allowedStrategies.join(', ')})`,
      )
    }
  }

  if (policy.allowedChainIds) {
    if (!plan.chainId) {
      violations.push('Plan chainId is missing but the policy requires an allowed chain')
    } else if (!policy.allowedChainIds.includes(plan.chainId)) {
      violations.push(
        `Plan chainId "${plan.chainId}" is not in the allowed chain list (${policy.allowedChainIds.join(', ')})`,
      )
    }
  }

  if (policy.maxSuggestedSlippageBps !== undefined) {
    if (plan.slippageBpsSuggested === undefined) {
      violations.push(
        'Plan slippageBpsSuggested is missing but the policy requires a maximum suggested slippage',
      )
    } else if (plan.slippageBpsSuggested > policy.maxSuggestedSlippageBps) {
      violations.push(
        `Plan suggested slippage ${plan.slippageBpsSuggested}bps exceeds the policy maximum of ${policy.maxSuggestedSlippageBps}bps`,
      )
    }
  }

  if (policy.maxSuggestedDeadlineSeconds !== undefined) {
    if (plan.deadlineSecondsSuggested === undefined) {
      violations.push(
        'Plan deadlineSecondsSuggested is missing but the policy requires a maximum suggested deadline',
      )
    } else if (plan.deadlineSecondsSuggested > policy.maxSuggestedDeadlineSeconds) {
      violations.push(
        `Plan suggested deadline ${plan.deadlineSecondsSuggested}s exceeds the policy maximum of ${policy.maxSuggestedDeadlineSeconds}s`,
      )
    }
  }

  const allowedReceivers = policy.allowedReceivers?.map((receiver) =>
    receiver.toLowerCase(),
  )

  plan.actions.forEach((action, index) => {
    if (
      policy.allowedActionTypes &&
      !policy.allowedActionTypes.includes(action.type)
    ) {
      violations.push(
        `Action ${index} has type "${action.type}", which is not in the allowed action type list (${policy.allowedActionTypes.join(', ')})`,
      )
    }

    if (!allowedReceivers) {
      return
    }

    const receiver = action.transactionTemplate?.receiver
    if (!receiver) {
      if (!parameters.ignoreUnsupportedActions) {
        violations.push(
          `Action ${index} (${action.type}) is missing a transaction template receiver required by the policy allowlist`,
        )
      }
      return
    }

    if (!allowedReceivers.includes(receiver.toLowerCase())) {
      violations.push(
        `Action ${index} (${action.type}) targets receiver "${receiver}", which is not in the allowed receiver list`,
      )
    }
  })

  if (violations.length > 0) {
    throw new SwapPlanPolicyError({
      violations,
      policy,
      plan,
    })
  }
}

export async function buildTransactionsFromSwapPlan(
  parameters: BuildSwapPlanTransactionsParameters,
): Promise<Transaction[]> {
  if (parameters.executionPolicy) {
    validateSwapExecutionPlan({
      plan: parameters.plan,
      policy: parameters.executionPolicy,
      ...(parameters.ignoreUnsupportedActions !== undefined
        ? { ignoreUnsupportedActions: parameters.ignoreUnsupportedActions }
        : {}),
    })
  }

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

export async function simulateSwapPlan(
  parameters: SimulateSwapPlanParameters,
): Promise<SimulateSwapPlanResult> {
  if (parameters.executionPolicy) {
    validateSwapExecutionPlan({
      plan: parameters.plan,
      policy: parameters.executionPolicy,
      ...(parameters.ignoreUnsupportedActions !== undefined
        ? { ignoreUnsupportedActions: parameters.ignoreUnsupportedActions }
        : {}),
    })
  }

  const sender =
    typeof parameters.sender === 'string'
      ? Address.newFromBech32(parameters.sender)
      : parameters.sender
  const actionOutputs = { ...(parameters.actionOutputs || {}) }
  const simulations: SimulatedSwapPlanAction[] = []
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

    const simulation = await simulateSwapPlanAction({
      provider: parameters.provider,
      action,
      actionIndex,
      sender,
      transaction,
    })

    simulations.push(simulation)

    if (!simulation.simulatedTransaction.status.isSuccessful()) {
      throw new SwapPlanSimulationError({
        actionOutputs,
        simulations: [...simulations],
        failedSimulation: simulation,
      })
    }

    if (simulation.output) {
      actionOutputs[actionIndex] = simulation.output
    }

    nextNonce += 1n
  }

  return {
    actionOutputs,
    simulations,
  }
}

export async function executeSwapPlan(
  parameters: ExecuteSwapPlanParameters,
): Promise<ExecuteSwapPlanResult> {
  if (parameters.executionPolicy) {
    validateSwapExecutionPlan({
      plan: parameters.plan,
      policy: parameters.executionPolicy,
      ...(parameters.ignoreUnsupportedActions !== undefined
        ? { ignoreUnsupportedActions: parameters.ignoreUnsupportedActions }
        : {}),
    })
  }

  const actionOutputs = { ...(parameters.actionOutputs || {}) }
  const executions: ExecutedSwapPlanAction[] = []
  const simulations: SimulatedSwapPlanAction[] = []
  const sender = parameters.signer.address
  const simulationProvider =
    parameters.simulateBeforeBroadcast
      ? resolveSimulationProvider(parameters)
      : undefined
  let nextNonce = (await parameters.provider.getAccount(sender)).nonce

  if (parameters.simulateBeforeBroadcast && !simulationProvider) {
    throw new Error(
      'simulateBeforeBroadcast requires a provider or simulationProvider with simulateTransaction()',
    )
  }

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

    if (simulationProvider) {
      const simulation = await simulateSwapPlanAction({
        provider: simulationProvider,
        action,
        actionIndex,
        sender,
        transaction,
      })

      simulations.push(simulation)

      if (!simulation.simulatedTransaction.status.isSuccessful()) {
        throw new SwapPlanSimulationError({
          actionOutputs,
          simulations: [...simulations],
          failedSimulation: simulation,
        })
      }
    }

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
    const status = completedTransaction.status.toString()
    const failureReason = extractTransactionFailureReason(completedTransaction)

    if (!completedTransaction.status.isSuccessful()) {
      const failedExecution: ExecutedSwapPlanAction = {
        actionIndex,
        actionType: action.type,
        txHash,
        transaction,
        completedTransaction,
        status,
        ...(failureReason ? { failureReason } : {}),
      }

      executions.push(failedExecution)

      throw new SwapPlanExecutionError({
        actionOutputs,
        executions: [...executions],
        failedExecution,
      })
    }

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
      status,
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

async function simulateSwapPlanAction(parameters: {
  provider: Pick<INetworkProvider, 'simulateTransaction'>
  action: SwapPlanAction
  actionIndex: number
  sender: Address
  transaction: Transaction
}): Promise<SimulatedSwapPlanAction> {
  const simulatedTransaction = await parameters.provider.simulateTransaction(
    parameters.transaction,
  )
  const status = simulatedTransaction.status.toString()
  const failureReason = extractTransactionFailureReason(simulatedTransaction)
  const output = simulatedTransaction.status.isSuccessful()
    ? extractActionOutput({
        action: parameters.action,
        sender: parameters.sender,
        transaction: simulatedTransaction,
      })
    : undefined

  return {
    actionIndex: parameters.actionIndex,
    actionType: parameters.action.type,
    transaction: parameters.transaction,
    simulatedTransaction,
    status,
    ...(output ? { output } : {}),
    ...(failureReason ? { failureReason } : {}),
  }
}

function resolveSimulationProvider(
  parameters: ExecuteSwapPlanParameters,
): Pick<INetworkProvider, 'simulateTransaction'> | undefined {
  if (parameters.simulationProvider) {
    return parameters.simulationProvider
  }

  const providerWithSimulation = parameters.provider as ExecuteSwapPlanParameters['provider'] &
    Partial<Pick<INetworkProvider, 'simulateTransaction'>>

  if (typeof providerWithSimulation.simulateTransaction === 'function') {
    return {
      simulateTransaction: providerWithSimulation.simulateTransaction.bind(
        providerWithSimulation,
      ),
    }
  }

  return undefined
}

function extractTransactionFailureReason(
  transaction: TransactionOnNetwork,
): string | undefined {
  const raw = transaction.raw as Record<string, unknown> | undefined
  const directReason = [
    raw?.reason,
    raw?.returnMessage,
    raw?.error,
    raw?.failReason,
    raw?.message,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (directReason) {
    return directReason
  }

  const signalErrorEvent = transaction.logs?.findFirstOrNoneEvent?.('signalError')
  if (signalErrorEvent) {
    const segments = [signalErrorEvent.data, ...signalErrorEvent.additionalData]
      .map((value) => decodeUtf8(value))
      .filter((value) => value.length > 0)

    if (segments.length > 0) {
      return segments.join(' | ')
    }
  }

  if (!transaction.status.isSuccessful()) {
    return transaction.status.toString()
  }

  return undefined
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

function decodeUtf8(value: Uint8Array | undefined): string {
  if (!value || value.length === 0) {
    return ''
  }

  return Buffer.from(value).toString('utf8').replace(/\0/g, '').trim()
}
