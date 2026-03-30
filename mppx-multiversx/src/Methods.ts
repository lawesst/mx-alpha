import { Method, z } from 'mppx'

/**
 * Parses a human-readable decimal amount string into its smallest unit representation.
 * E.g., parseUnits("1.5", 18) => "1500000000000000000"
 */
function parseUnits(amount: string, decimals: number): bigint {
  const [whole = '0', fraction = ''] = amount.split('.')
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + paddedFraction)
}

/**
 * MultiversX charge intent for one-time payments natively via EGLD or ESDT tokens.
 *
 * Employs Data Payload Tagging to inject the MPP challenge ID into the MultiversX `data` field.
 *
 * Schema follows the MPP Charge Intent spec:
 * - `amount` (REQUIRED): human-readable payment amount
 * - `currency` (REQUIRED): token identifier (EGLD, USDC-c76f31, etc.)
 * - `recipient` (REQUIRED): bech32 MultiversX address
 * - `chainId` (OPTIONAL): chain selector (1=mainnet, D=devnet, T=testnet)
 * - `decimals` (OPTIONAL): token precision, defaults to 18
 */
export const charge = Method.from({
  name: 'multiversx',
  intent: 'charge',
  schema: {
    credential: {
      payload: z.object({
        externalId: z.optional(z.string()),
        txHash: z.string(),
        sender: z.string(),
      }),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        decimals: z.optional(z.number()), // EGLD defaults to 18
        currency: z.string(), // REQUIRED per spec — token identifier e.g. "EGLD" or "USDC-c76f31"
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        metadata: z.optional(z.record(z.string(), z.string())),
        chainId: z.optional(z.string()),
        recipient: z.string(),
      }),
      z.transform((data: any) => {
        const { amount, decimals = 18, metadata, chainId = 'D', currency, ...rest } = data
        return {
          ...rest,
          amount: parseUnits(amount, decimals).toString(),
          currency,
          methodDetails: {
            chainId,
            decimals,
            ...(metadata !== undefined && { metadata }),
          },
        }
      }),
    ),
  },
})

export const session = Method.from({
  name: 'multiversx',
  intent: 'session',
  schema: {
    credential: {
      payload: z.object({
        externalId: z.optional(z.string()),
        txHash: z.string(),
        sender: z.string(),
      }),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        decimals: z.optional(z.number()),
        currency: z.string(),
        duration: z.string(),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        metadata: z.optional(z.record(z.string(), z.string())),
        chainId: z.optional(z.string()),
        recipient: z.string(),
      }),
      z.transform((data: any) => {
        const { amount, decimals = 18, metadata, chainId = 'D', currency, duration, ...rest } = data
        return {
          ...rest,
          amount: parseUnits(amount, decimals).toString(),
          currency,
          duration,
          methodDetails: {
            chainId,
            decimals,
            ...(metadata !== undefined && { metadata }),
          },
        }
      }),
    ),
  },
})

export const subscription = Method.from({
  name: 'multiversx',
  intent: 'subscription',
  schema: {
    credential: {
      payload: z.object({
        externalId: z.optional(z.string()),
        txHash: z.string(),
        sender: z.string(),
      }),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        decimals: z.optional(z.number()),
        currency: z.string(),
        interval: z.string(),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        metadata: z.optional(z.record(z.string(), z.string())),
        chainId: z.optional(z.string()),
        recipient: z.string(),
      }),
      z.transform((data: any) => {
        const { amount, decimals = 18, metadata, chainId = 'D', currency, interval, ...rest } = data
        return {
          ...rest,
          amount: parseUnits(amount, decimals).toString(),
          currency,
          interval,
          methodDetails: {
            chainId,
            decimals,
            ...(metadata !== undefined && { metadata }),
          },
        }
      }),
    ),
  },
})
