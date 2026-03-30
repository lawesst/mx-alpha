import {
  Address,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  Transaction,
  TransactionsFactoryConfig,
} from '@multiversx/sdk-core'
import { BigUIntValue, TokenIdentifierValue } from '@multiversx/sdk-core'

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
    amount: string
  }>
  arguments?: Array<
    | { type: 'TokenIdentifier'; value: string }
    | { type: 'BigUInt'; value: string }
  >
}

export type SwapPlanAction = {
  type: string
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
}

export async function buildTransactionsFromSwapPlan(
  parameters: BuildSwapPlanTransactionsParameters,
): Promise<Transaction[]> {
  const sender =
    typeof parameters.sender === 'string'
      ? Address.newFromBech32(parameters.sender)
      : parameters.sender
  const templates = parameters.plan.actions
    .map((action) => action.transactionTemplate)
    .filter((template): template is SwapPlanTransactionTemplate => Boolean(template))

  if (!parameters.ignoreUnsupportedActions) {
    const unsupportedActions = parameters.plan.actions.filter(
      (action) => action.type !== 'swap-fixed-input' && !action.transactionTemplate,
    )

    if (unsupportedActions.length > 0) {
      throw new Error(
        `Unsupported swap plan actions without templates: ${unsupportedActions
          .map((action) => action.type)
          .join(', ')}`,
      )
    }
  }

  const transactions: Transaction[] = []

  for (const template of templates) {
    const txConfig = new TransactionsFactoryConfig({
      chainID: template.chainId || parameters.plan.chainId || 'D',
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

    const transaction = await factory.createTransactionForExecute(sender, {
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
              (transfer) =>
                new TokenTransfer({
                  token: new Token({
                    identifier: transfer.token,
                    ...(transfer.nonce ? { nonce: BigInt(transfer.nonce) } : {}),
                  }),
                  amount: BigInt(transfer.amount),
                }),
            ),
          }
        : {}),
    })

    transactions.push(transaction)
  }

  return transactions
}
