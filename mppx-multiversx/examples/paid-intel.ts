import { Credential } from 'mppx'
import { Mppx } from 'mppx/client'
import {
  Account,
  Address,
  ApiNetworkProvider,
  Token,
  TokenTransfer,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
} from '@multiversx/sdk-core'
import {
  SwapPlanExecutionError,
  SwapPlanPolicyError,
  SwapPlanSimulationError,
  buildTransactionsFromSwapPlan,
  executeSwapPlan,
  simulateSwapPlan,
  multiversx,
} from '../src/client/index.ts'
import type {
  SwapExecutionPlan,
  SwapPlanExecutionPolicy,
} from '../src/client/index.ts'
import {
  buildPaidIntelAuditReport,
  persistPaidIntelAuditReport,
  uploadPaidIntelAuditReport,
} from './paid-intel-report.ts'

type ExampleRequest =
  | { kind: 'token-risk'; token: string }
  | { kind: 'wallet-profile'; address: string }
  | { kind: 'swap-sim'; from: string; to: string; amount: string }
  | { kind: 'swap-plan'; from: string; to: string; amount: string }

const HELP_TEXT = `
Usage:
  npm run example:paid-intel -- token-risk <TOKEN_IDENTIFIER>
  npm run example:paid-intel -- wallet-profile <BECH32_ADDRESS>
  npm run example:paid-intel -- swap-sim <FROM_ASSET> <TO_ASSET> <AMOUNT>
  npm run example:paid-intel -- swap-plan <FROM_ASSET> <TO_ASSET> <AMOUNT>

Environment:
  MX_PEM_PATH         Path to the MultiversX PEM file used to pay
  MX_INTEL_BASE_URL   Facilitator base URL (default: http://localhost:3000)
  MX_API_URL          Optional override for the MultiversX API URL
  MX_SETTLEMENT_TIMEOUT_MS  Optional tx settlement timeout in milliseconds (default: 60000)
  MX_POST_SETTLEMENT_DELAY_MS  Optional delay before retry after settlement (default: 3000)
  MX_SIMULATE_SWAP_PLAN  Set to "true" to dry-run swap-plan actions without broadcasting
  MX_EXECUTE_SWAP_PLAN  Set to "true" to sign and submit swap-plan actions after fetching the paid plan
  MX_SKIP_PREBROADCAST_SIMULATION  Set to "true" to execute without the built-in dry-run guard
  MX_SWAP_MAX_ACTIONS  Optional policy guard for maximum action count (default when executing: 4)
  MX_SWAP_ALLOWED_ACTION_TYPES  Optional comma-separated action allowlist
  MX_SWAP_ALLOWED_RECEIVERS  Optional comma-separated contract receiver allowlist
  MX_SWAP_ALLOWED_CHAIN_IDS  Optional comma-separated chain allowlist
  MX_SWAP_ALLOWED_STRATEGIES  Optional comma-separated strategy allowlist (default when executing: xexchange-pair-sequence)
  MX_SWAP_MAX_SLIPPAGE_BPS  Optional maximum allowed suggested slippage
  MX_SWAP_MAX_DEADLINE_SECONDS  Optional maximum allowed suggested deadline
  MX_REPORT_DIR  Optional directory for writing a JSON audit report
  MX_REPORT_FILE  Optional exact JSON audit report file path
  MX_UPLOAD_AUDIT_REPORT  Set to "true" to POST the generated audit report to the facilitator
  MX_AUDIT_REPORT_URL  Optional exact upload URL for the facilitator audit endpoint

Examples:
  MX_PEM_PATH=./wallet.pem npm run example:paid-intel -- token-risk XMEX-abc123
  MX_PEM_PATH=./wallet.pem npm run example:paid-intel -- wallet-profile erd1...
  MX_PEM_PATH=./wallet.pem npm run example:paid-intel -- swap-sim EGLD USDC-c76f1f 1.25
  MX_PEM_PATH=./wallet.pem npm run example:paid-intel -- swap-plan USDC-c76f1f RIDE-7d18e9 25
`.trim()

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (!args[0] || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP_TEXT)
    return
  }

  const request = parseRequest(args)

  const pemPath = process.env.MX_PEM_PATH
  if (!pemPath) {
    throw new Error('MX_PEM_PATH is required so the example can sign the payment transaction.')
  }

  const baseUrl = process.env.MX_INTEL_BASE_URL || 'http://localhost:3000'
  const account = await Account.newFromPem(pemPath)
  const sender = account.address.toBech32()

  const client = Mppx.create({
    polyfill: false,
    methods: [
      multiversx.charge({
        signAndSendTransaction: async ({ amount, challenge, currency, chainId, recipient }) => {
          const provider = new ApiNetworkProvider(resolveApiUrl(chainId), {
            clientName: 'mppx-multiversx-example',
          })

          const txHash = await signAndSendTaggedTransfer({
            account,
            amount,
            challengeId: challenge.id,
            currency,
            provider,
            recipient,
            chainId: chainId || 'D',
          })

          return { txHash, sender }
        },
      }),
    ],
  })

  const url = buildIntelUrl(baseUrl, request)
  const { response, txHash } = await fetchPaidResource({
    client,
    sender,
    url,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed with status ${response.status}: ${body}`)
  }

  const receipt = response.headers.get('payment-receipt')
  const payload = (await response.json()) as Record<string, unknown>
  const executionPolicy = request.kind === 'swap-plan' ? buildSwapExecutionPolicy() : undefined
  const unsignedTransactions =
    request.kind === 'swap-plan'
      ? await buildUnsignedSwapPlanTransactions(sender, payload)
      : undefined
  const simulation =
    request.kind === 'swap-plan' && process.env.MX_SIMULATE_SWAP_PLAN === 'true'
      ? await simulatePaidSwapPlan({
          sender,
          payload,
          executionPolicy,
        })
      : undefined
  const execution =
    request.kind === 'swap-plan' && process.env.MX_EXECUTE_SWAP_PLAN === 'true'
      ? await executePaidSwapPlan({
          account,
          payload,
          executionPolicy,
        })
      : undefined
  const simulationError =
    request.kind === 'swap-plan' &&
    process.env.MX_SIMULATE_SWAP_PLAN === 'true' &&
    simulation instanceof SwapPlanSimulationError
      ? serializeSwapPlanSimulationError(simulation)
      : undefined
  const simulationPolicyError =
    request.kind === 'swap-plan' &&
    process.env.MX_SIMULATE_SWAP_PLAN === 'true' &&
    simulation instanceof SwapPlanPolicyError
      ? serializeSwapPlanPolicyError(simulation)
      : undefined
  const executionError =
    request.kind === 'swap-plan' &&
    process.env.MX_EXECUTE_SWAP_PLAN === 'true' &&
    execution instanceof SwapPlanExecutionError
      ? serializeSwapPlanExecutionError(execution)
      : undefined
  const executionSimulationError =
    request.kind === 'swap-plan' &&
    process.env.MX_EXECUTE_SWAP_PLAN === 'true' &&
    execution instanceof SwapPlanSimulationError
      ? serializeSwapPlanSimulationError(execution)
      : undefined
  const executionPolicyError =
    request.kind === 'swap-plan' &&
    process.env.MX_EXECUTE_SWAP_PLAN === 'true' &&
    execution instanceof SwapPlanPolicyError
      ? serializeSwapPlanPolicyError(execution)
      : undefined
  const result = {
    endpoint: request.kind,
    receipt,
    txHash,
    payload,
    ...(unsignedTransactions ? { unsignedTransactions } : {}),
    ...(simulation &&
    !(simulation instanceof SwapPlanSimulationError) &&
    !(simulation instanceof SwapPlanPolicyError)
      ? { simulation }
      : {}),
    ...(simulationError ? { simulationError } : {}),
    ...(simulationPolicyError ? { simulationPolicyError } : {}),
    ...(execution && !(execution instanceof SwapPlanExecutionError)
      && !(execution instanceof SwapPlanSimulationError)
      && !(execution instanceof SwapPlanPolicyError)
      ? { execution }
      : {}),
    ...(executionError ? { executionError } : {}),
    ...(executionSimulationError ? { executionSimulationError } : {}),
    ...(executionPolicyError ? { executionPolicyError } : {}),
  }
  const auditReport = buildPaidIntelAuditReport({
    endpoint: request.kind,
    request: {
      kind: request.kind,
      ...request,
    },
    sender,
    facilitatorBaseUrl: baseUrl,
    receipt,
    paymentTxHash: txHash,
    ...(executionPolicy ? { executionPolicy } : {}),
    result,
  })
  const reportPath = await persistPaidIntelAuditReport({
    report: auditReport,
    outputDir: process.env.MX_REPORT_DIR,
    outputFile: process.env.MX_REPORT_FILE,
  })
  const { uploadedReport, uploadError } = shouldUploadAuditReport()
    ? await uploadAuditReport({
        auditReport,
        baseUrl,
      })
    : { uploadedReport: undefined, uploadError: undefined }
  const output = {
    ...result,
    ...(reportPath ? { reportPath } : {}),
    ...(uploadedReport ? { uploadedReport } : {}),
    ...(uploadError ? { uploadError } : {}),
  }

  console.log(
    JSON.stringify(output, null, 2),
  )

  if (
    simulationError ||
    simulationPolicyError ||
    executionError ||
    executionSimulationError ||
    executionPolicyError ||
    uploadError
  ) {
    process.exitCode = 1
  }
}

function parseRequest(args: string[]): ExampleRequest {
  const [kind, ...rest] = args

  if (kind === 'token-risk') {
    if (!rest[0]) {
      throw new Error(`Missing token identifier for "${kind}".\n\n${HELP_TEXT}`)
    }
    return { kind, token: rest[0] }
  }

  if (kind === 'wallet-profile') {
    if (!rest[0]) {
      throw new Error(`Missing wallet address for "${kind}".\n\n${HELP_TEXT}`)
    }
    return { kind, address: rest[0] }
  }

  if (kind === 'swap-sim' || kind === 'swap-plan') {
    const [from, to, amount] = rest
    if (!from || !to || !amount) {
      throw new Error(`Missing from/to/amount values for "${kind}".\n\n${HELP_TEXT}`)
    }
    return { kind, from, to, amount }
  }

  throw new Error(
    `Unsupported endpoint "${kind}". Expected "token-risk", "wallet-profile", "swap-sim", or "swap-plan".`,
  )
}

function buildIntelUrl(baseUrl: string, request: ExampleRequest): string {
  const url = new URL(`/intel/${request.kind}`, baseUrl)

  if (request.kind === 'token-risk') {
    url.searchParams.set('token', request.token)
  } else if (request.kind === 'wallet-profile') {
    url.searchParams.set('address', request.address)
  } else {
    url.searchParams.set('from', request.from)
    url.searchParams.set('to', request.to)
    url.searchParams.set('amount', request.amount)
  }

  return url.toString()
}

function resolveApiUrl(chainId?: string): string {
  if (process.env.MX_API_URL) return process.env.MX_API_URL

  switch (chainId) {
    case '1':
      return 'https://api.multiversx.com'
    case 'T':
      return 'https://testnet-api.multiversx.com'
    case 'D':
    default:
      return 'https://devnet-api.multiversx.com'
  }
}

async function fetchPaidResource(options: {
  client: ReturnType<typeof Mppx.create>
  sender: string
  url: string
}): Promise<{ response: Response; txHash: string | null }> {
  const initialResponse = await fetch(options.url, { method: 'GET' })

  if (initialResponse.status !== 402) {
    return { response: initialResponse, txHash: null }
  }

  const credential = await options.client.createCredential(initialResponse, {
    sender: options.sender,
  })
  const parsedCredential = Credential.deserialize(credential)
  const txHash = String(parsedCredential.payload.txHash)
  const chainId = parsedCredential.challenge.request.methodDetails?.chainId as
    | string
    | undefined

  await waitForTransactionSettlement({
    apiUrl: resolveApiUrl(chainId),
    txHash,
  })
  await waitAfterSettlement()

  const authorizedResponse = await fetch(options.url, {
    method: 'GET',
    headers: { Authorization: credential },
  })

  return { response: authorizedResponse, txHash }
}

async function signAndSendTaggedTransfer(options: {
  account: Account
  amount: string
  challengeId: string
  currency: string
  provider: ApiNetworkProvider
  recipient: string
  chainId: string
}): Promise<string> {
  const { account, amount, challengeId, currency, provider, recipient, chainId } = options
  const recipientAddress = Address.newFromBech32(recipient)
  const networkConfig = await provider.getNetworkConfig()
  const accountOnNetwork = await provider.getAccount(account.address)

  const txConfig = new TransactionsFactoryConfig({ chainID: chainId })
  txConfig.minGasLimit = networkConfig.minGasLimit
  txConfig.gasLimitPerByte = networkConfig.gasPerDataByte

  const factory = new TransferTransactionsFactory({ config: txConfig })
  const tag = `mpp:${challengeId}`

  const transaction =
    currency === 'EGLD'
      ? await factory.createTransactionForNativeTokenTransfer(account.address, {
          receiver: recipientAddress,
          nativeAmount: BigInt(amount),
          data: Buffer.from(tag),
        })
      : await createTaggedEsdtTransfer(factory, {
          amount,
          currency,
          gasPerDataByte: networkConfig.gasPerDataByte,
          receiver: recipientAddress,
          sender: account.address,
          tag,
        })

  transaction.nonce = BigInt(accountOnNetwork.nonce)
  transaction.signature = await account.signTransaction(transaction)

  return provider.sendTransaction(transaction)
}

async function waitForTransactionSettlement(options: {
  apiUrl: string
  txHash: string
}): Promise<void> {
  const provider = new ApiNetworkProvider(options.apiUrl, {
    clientName: 'mppx-multiversx-example',
  })
  const timeoutMs = parseInt(process.env.MX_SETTLEMENT_TIMEOUT_MS || '60000', 10)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const tx = await provider.getTransaction(options.txHash).catch(() => null)
    const status =
      typeof tx?.status === 'string'
        ? tx.status
        : tx?.status?.isSuccessful?.()
          ? 'success'
          : tx?.status?.isPending?.()
            ? 'pending'
            : 'unknown'

    if (status === 'success') {
      return
    }

    if (status !== 'pending' && status !== 'unknown') {
      throw new Error(`Transaction ${options.txHash} did not settle successfully: ${status}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Transaction ${options.txHash} did not settle within ${timeoutMs}ms`)
}

async function waitAfterSettlement(): Promise<void> {
  const delayMs = parseInt(process.env.MX_POST_SETTLEMENT_DELAY_MS || '3000', 10)
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

async function buildUnsignedSwapPlanTransactions(
  sender: string,
  payload: Record<string, unknown>,
) {
  const executionPlan = extractExecutionPlan(payload)
  if (!executionPlan?.actions) {
    return undefined
  }

  const transactions = await buildTransactionsFromSwapPlan({
    sender,
    plan: executionPlan,
    ignoreUnsupportedActions: true,
  })

  return transactions.map((transaction) => ({
    receiver: transaction.receiver.toBech32(),
    gasLimit: transaction.gasLimit.toString(),
    value: transaction.value.toString(),
    data: Buffer.from(transaction.data).toString(),
  }))
}

async function executePaidSwapPlan(options: {
  account: Account
  payload: Record<string, unknown>
  executionPolicy?: SwapPlanExecutionPolicy
}): Promise<
  | ReturnType<typeof serializeExecutionResult>
  | SwapPlanExecutionError
  | SwapPlanSimulationError
  | SwapPlanPolicyError
  | undefined
> {
  const executionPlan = extractExecutionPlan(options.payload)
  if (!executionPlan?.actions) {
    return undefined
  }

  const provider = new ApiNetworkProvider(resolveApiUrl(executionPlan.chainId), {
    clientName: 'mppx-multiversx-example',
  })
  try {
    const result = await executeSwapPlan({
      signer: options.account,
      provider,
      plan: executionPlan,
      ignoreUnsupportedActions: true,
      simulateBeforeBroadcast:
        process.env.MX_SKIP_PREBROADCAST_SIMULATION !== 'true',
      ...(options.executionPolicy ? { executionPolicy: options.executionPolicy } : {}),
    })

    return serializeExecutionResult(result)
  } catch (error) {
    if (error instanceof SwapPlanExecutionError) {
      return error
    }

    if (error instanceof SwapPlanPolicyError) {
      return error
    }

    if (error instanceof SwapPlanSimulationError) {
      return error
    }

    throw error
  }
}

async function simulatePaidSwapPlan(options: {
  sender: string
  payload: Record<string, unknown>
  executionPolicy?: SwapPlanExecutionPolicy
}): Promise<
  | ReturnType<typeof serializeSimulationResult>
  | SwapPlanSimulationError
  | SwapPlanPolicyError
  | undefined
> {
  const executionPlan = extractExecutionPlan(options.payload)
  if (!executionPlan?.actions) {
    return undefined
  }

  const provider = new ApiNetworkProvider(resolveApiUrl(executionPlan.chainId), {
    clientName: 'mppx-multiversx-example',
  })

  try {
    const result = await simulateSwapPlan({
      sender: options.sender,
      provider,
      plan: executionPlan,
      ignoreUnsupportedActions: true,
      ...(options.executionPolicy ? { executionPolicy: options.executionPolicy } : {}),
    })

    return serializeSimulationResult(result)
  } catch (error) {
    if (error instanceof SwapPlanSimulationError) {
      return error
    }

    if (error instanceof SwapPlanPolicyError) {
      return error
    }

    throw error
  }
}

function extractExecutionPlan(payload: Record<string, unknown>): SwapExecutionPlan | undefined {
  const executionPlan = payload.executionPlan

  if (!executionPlan || typeof executionPlan !== 'object') {
    return undefined
  }

  const candidate = executionPlan as SwapExecutionPlan
  if (!Array.isArray(candidate.actions)) {
    return undefined
  }

  return candidate
}

function buildSwapExecutionPolicy(): SwapPlanExecutionPolicy | undefined {
  const isExecuting = process.env.MX_EXECUTE_SWAP_PLAN === 'true'
  const maxActionCount = parseOptionalInteger(process.env.MX_SWAP_MAX_ACTIONS)
  const allowedActionTypes = parseCsvEnv(process.env.MX_SWAP_ALLOWED_ACTION_TYPES)
  const allowedReceivers = parseCsvEnv(process.env.MX_SWAP_ALLOWED_RECEIVERS)
  const allowedChainIds = parseCsvEnv(process.env.MX_SWAP_ALLOWED_CHAIN_IDS)
  const allowedStrategies = parseCsvEnv(process.env.MX_SWAP_ALLOWED_STRATEGIES)
  const maxSuggestedSlippageBps = parseOptionalInteger(
    process.env.MX_SWAP_MAX_SLIPPAGE_BPS,
  )
  const maxSuggestedDeadlineSeconds = parseOptionalInteger(
    process.env.MX_SWAP_MAX_DEADLINE_SECONDS,
  )

  if (
    !isExecuting &&
    maxActionCount === undefined &&
    !allowedActionTypes &&
    !allowedReceivers &&
    !allowedChainIds &&
    !allowedStrategies &&
    maxSuggestedSlippageBps === undefined &&
    maxSuggestedDeadlineSeconds === undefined
  ) {
    return undefined
  }

  return {
    ...(maxActionCount !== undefined
      ? { maxActionCount }
      : isExecuting
        ? { maxActionCount: 4 }
        : {}),
    ...(allowedActionTypes
      ? { allowedActionTypes }
      : isExecuting
        ? { allowedActionTypes: ['wrap-egld', 'swap-fixed-input', 'unwrap-egld'] }
        : {}),
    ...(allowedReceivers ? { allowedReceivers } : {}),
    ...(allowedChainIds ? { allowedChainIds } : {}),
    ...(allowedStrategies
      ? { allowedStrategies }
      : isExecuting
        ? { allowedStrategies: ['xexchange-pair-sequence'] }
        : {}),
    ...(maxSuggestedSlippageBps !== undefined
      ? { maxSuggestedSlippageBps }
      : {}),
    ...(maxSuggestedDeadlineSeconds !== undefined
      ? { maxSuggestedDeadlineSeconds }
      : {}),
  }
}

async function createTaggedEsdtTransfer(
  factory: TransferTransactionsFactory,
  options: {
    amount: string
    currency: string
    gasPerDataByte: bigint
    receiver: Address
    sender: Address
    tag: string
  },
) {
  const transfer = new TokenTransfer({
    token: new Token({ identifier: options.currency }),
    amount: BigInt(options.amount),
  })

  const transaction = await factory.createTransactionForESDTTokenTransfer(options.sender, {
    receiver: options.receiver,
    tokenTransfers: [transfer],
  })

  const taggedData = `${Buffer.from(transaction.data).toString()}@${Buffer.from(options.tag).toString('hex')}`
  transaction.data = Buffer.from(taggedData)
  transaction.gasLimit += BigInt(Buffer.byteLength(`@${Buffer.from(options.tag).toString('hex')}`)) * options.gasPerDataByte

  return transaction
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})

function serializeExecutionResult(result: {
  actionOutputs: Record<number, { token?: string; amount: string }>
  simulations?: Array<{
    actionIndex: number
    actionType: string
    status: string
    output?: { token?: string; amount: string }
    failureReason?: string
    transaction: {
      receiver: Address
      gasLimit: bigint
      value: bigint
      data: Uint8Array | Buffer
    }
  }>
  executions: Array<{
    actionIndex: number
    actionType: string
    txHash: string
    status: string
    preBroadcastSimulation?: {
      actionIndex: number
      actionType: string
      status: string
      output?: { token?: string; amount: string }
      failureReason?: string
      transaction: {
        receiver: Address
        gasLimit: bigint
        value: bigint
        data: Uint8Array | Buffer
      }
    }
    output?: { token?: string; amount: string }
    outputComparison?: {
      simulatedToken?: string
      actualToken?: string
      simulatedAmount: string
      actualAmount: string
      deltaAmount?: string
      absoluteDeltaAmount?: string
    }
    failureReason?: string
    transaction: {
      receiver: Address
      gasLimit: bigint
      value: bigint
      data: Uint8Array | Buffer
    }
  }>
}) {
  return {
    actionOutputs: result.actionOutputs,
    ...(result.simulations
      ? {
          simulations: serializeSimulationResult({
            actionOutputs: result.actionOutputs,
            simulations: result.simulations,
          }).simulations,
        }
      : {}),
    executions: result.executions.map((execution) => ({
      actionIndex: execution.actionIndex,
      actionType: execution.actionType,
      txHash: execution.txHash,
      status: execution.status,
      ...(execution.preBroadcastSimulation
        ? {
            preBroadcastSimulation: serializeSimulationAction(
              execution.preBroadcastSimulation,
            ),
          }
        : {}),
      ...(execution.output ? { output: execution.output } : {}),
      ...(execution.outputComparison
        ? { outputComparison: execution.outputComparison }
        : {}),
      ...(execution.failureReason ? { failureReason: execution.failureReason } : {}),
      receiver: execution.transaction.receiver.toBech32(),
      gasLimit: execution.transaction.gasLimit.toString(),
      value: execution.transaction.value.toString(),
      data: Buffer.from(execution.transaction.data).toString(),
    })),
  }
}

function serializeSimulationResult(result: {
  actionOutputs: Record<number, { token?: string; amount: string }>
  simulations: Array<{
    actionIndex: number
    actionType: string
    status: string
    output?: { token?: string; amount: string }
    failureReason?: string
    transaction: {
      receiver: Address
      gasLimit: bigint
      value: bigint
      data: Uint8Array | Buffer
    }
  }>
}) {
  return {
    actionOutputs: result.actionOutputs,
    simulations: result.simulations.map((simulation) =>
      serializeSimulationAction(simulation),
    ),
  }
}

function serializeSwapPlanExecutionError(error: SwapPlanExecutionError) {
  return {
    message: error.message,
    actionOutputs: error.actionOutputs,
    failedExecution: {
      actionIndex: error.failedExecution.actionIndex,
      actionType: error.failedExecution.actionType,
      txHash: error.failedExecution.txHash,
      status: error.failedExecution.status,
      ...(error.failedExecution.preBroadcastSimulation
        ? {
            preBroadcastSimulation: serializeSimulationAction(
              error.failedExecution.preBroadcastSimulation,
            ),
          }
        : {}),
      ...(error.failedExecution.output ? { output: error.failedExecution.output } : {}),
      ...(error.failedExecution.outputComparison
        ? { outputComparison: error.failedExecution.outputComparison }
        : {}),
      ...(error.failedExecution.failureReason
        ? { failureReason: error.failedExecution.failureReason }
        : {}),
      receiver: error.failedExecution.transaction.receiver.toBech32(),
      gasLimit: error.failedExecution.transaction.gasLimit.toString(),
      value: error.failedExecution.transaction.value.toString(),
      data: Buffer.from(error.failedExecution.transaction.data).toString(),
    },
    executions: serializeExecutionResult({
      actionOutputs: error.actionOutputs,
      ...(error.simulations ? { simulations: error.simulations } : {}),
      executions: error.executions,
    }).executions,
    ...(error.simulations
      ? {
          simulations: serializeSimulationResult({
            actionOutputs: error.actionOutputs,
            simulations: error.simulations,
          }).simulations,
        }
      : {}),
  }
}

function serializeSwapPlanSimulationError(error: SwapPlanSimulationError) {
  return {
    message: error.message,
    actionOutputs: error.actionOutputs,
    failedSimulation: {
      actionIndex: error.failedSimulation.actionIndex,
      actionType: error.failedSimulation.actionType,
      status: error.failedSimulation.status,
      ...(error.failedSimulation.output
        ? { output: error.failedSimulation.output }
        : {}),
      ...(error.failedSimulation.failureReason
        ? { failureReason: error.failedSimulation.failureReason }
        : {}),
      receiver: error.failedSimulation.transaction.receiver.toBech32(),
      gasLimit: error.failedSimulation.transaction.gasLimit.toString(),
      value: error.failedSimulation.transaction.value.toString(),
      data: Buffer.from(error.failedSimulation.transaction.data).toString(),
    },
    simulations: serializeSimulationResult({
      actionOutputs: error.actionOutputs,
      simulations: error.simulations,
    }).simulations,
  }
}

function serializeSwapPlanPolicyError(error: SwapPlanPolicyError) {
  return {
    message: error.message,
    violations: error.violations,
    policy: error.policy,
    planSummary: {
      chainId: error.plan.chainId,
      strategy: error.plan.strategy,
      slippageBpsSuggested: error.plan.slippageBpsSuggested,
      deadlineSecondsSuggested: error.plan.deadlineSecondsSuggested,
      actionCount: error.plan.actions.length,
    },
  }
}

function serializeSimulationAction(simulation: {
  actionIndex: number
  actionType: string
  status: string
  output?: { token?: string; amount: string }
  failureReason?: string
  transaction: {
    receiver: Address
    gasLimit: bigint
    value: bigint
    data: Uint8Array | Buffer
  }
}) {
  return {
    actionIndex: simulation.actionIndex,
    actionType: simulation.actionType,
    status: simulation.status,
    ...(simulation.output ? { output: simulation.output } : {}),
    ...(simulation.failureReason ? { failureReason: simulation.failureReason } : {}),
    receiver: simulation.transaction.receiver.toBech32(),
    gasLimit: simulation.transaction.gasLimit.toString(),
    value: simulation.transaction.value.toString(),
    data: Buffer.from(simulation.transaction.data).toString(),
  }
}

function parseCsvEnv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }

  const parsed = value
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  return parsed.length > 0 ? parsed : undefined
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer environment value but received "${value}"`)
  }

  return parsed
}

async function uploadAuditReport(parameters: {
  auditReport: ReturnType<typeof buildPaidIntelAuditReport>
  baseUrl: string
}): Promise<{
  uploadedReport?: Awaited<ReturnType<typeof uploadPaidIntelAuditReport>>
  uploadError?: { message: string }
}> {
  try {
    const uploadedReport = await uploadPaidIntelAuditReport({
      report: parameters.auditReport,
      baseUrl: parameters.baseUrl,
      uploadUrl: process.env.MX_AUDIT_REPORT_URL,
    })
    return { uploadedReport }
  } catch (error) {
    return {
      uploadError: {
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function shouldUploadAuditReport(): boolean {
  return process.env.MX_UPLOAD_AUDIT_REPORT === 'true'
}
