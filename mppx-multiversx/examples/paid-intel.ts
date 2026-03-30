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
  buildTransactionsFromSwapPlan,
  multiversx,
} from '../src/client/index.ts'

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
  const unsignedTransactions =
    request.kind === 'swap-plan'
      ? await buildUnsignedSwapPlanTransactions(sender, payload)
      : undefined

  console.log(
    JSON.stringify(
      {
        endpoint: request.kind,
        receipt,
        txHash,
        payload,
        ...(unsignedTransactions ? { unsignedTransactions } : {}),
      },
      null,
      2,
    ),
  )
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
  const executionPlan = payload.executionPlan as
    | {
        chainId?: string
        actions?: Array<{
          type: string
          transactionTemplate?: {
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
        }>
      }
    | undefined

  if (!executionPlan?.actions) {
    return undefined
  }

  const transactions = await buildTransactionsFromSwapPlan({
    sender,
    plan: {
      chainId: executionPlan.chainId,
      actions: executionPlan.actions,
    },
    ignoreUnsupportedActions: true,
  })

  return transactions.map((transaction) => ({
    receiver: transaction.receiver.toBech32(),
    gasLimit: transaction.gasLimit.toString(),
    value: transaction.value.toString(),
    data: Buffer.from(transaction.data).toString(),
  }))
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
