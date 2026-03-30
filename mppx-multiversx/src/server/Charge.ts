import { Errors, Method } from 'mppx'
import * as Methods from '../Methods.js'

/**
 * Creates a MultiversX charge method intent for usage on the server.
 *
 * Verifies payment by invoking the provided `verifyTransaction` callback.
 * It expects the callback to verify the transaction on the MultiversX blockchain using the
 * provided `txHash` and `sender` taking into account the `challengeId` as data payload.
 *
 * @example
 * ```ts
 * import { multiversx } from 'mppx-multiversx/server'
 *
 * const charge = multiversx.charge({
 *   currency: 'EGLD',
 *   verifyTransaction: async ({ txHash, sender, challengeId, amount, currency }) => {
 *     // query the MultiversX API to ensure the txHash is valid, successful,
 *     // has `challengeId` as data payload, sender matches, and amount/currency are correct.
 *     return { success: true }
 *   }
 * })
 * ```
 */
export function charge<const parameters extends charge.Parameters>(parameters: parameters) {
  const { amount, decimals, description, externalId, metadata, chainId, currency, verifyTransaction } =
    parameters

  type Defaults = charge.DeriveDefaults<parameters>
  return Method.toServer<typeof Methods.charge, Defaults>(Methods.charge, {
    defaults: {
      amount,
      decimals,
      description,
      externalId,
      metadata,
      chainId,
      currency,
    } as unknown as Defaults,

    async verify({ credential }) {
      const { challenge } = credential
      const parsed = Methods.charge.schema.credential.payload.safeParse(credential.payload)
      if (!parsed.success) throw new Error('Invalid credential payload: missing txHash or sender')
      const { txHash, sender, externalId: credentialExternalId } = parsed.data as {
        txHash: string
        sender: string
        externalId?: string
      }

      const result = await verifyTransaction({
        txHash,
        sender,
        challengeId: challenge.id,
        amount: challenge.request.amount as string,
        currency: challenge.request.currency as string,
        source: credential.source,
        opaque: challenge.opaque,
        digest: challenge.digest,
      })

      if (!result.success) {
        throw new Errors.VerificationFailedError({
          reason: result.error ?? 'MultiversX Transaction verification failed',
        })
      }

      return {
        method: 'multiversx',
        status: 'success',
        timestamp: new Date().toISOString(),
        reference: txHash,
        ...(credentialExternalId ? { externalId: credentialExternalId } : {}),
      } as const
    },
  })
}

export declare namespace charge {
  type Defaults = Omit<Method.RequestDefaults<typeof Methods.charge>, 'recipient'>

  type Parameters = {
    /** Callback to verify the transaction is real, successful, and valid for this challenge */
    verifyTransaction: (parameters: {
      txHash: string
      sender: string
      challengeId: string
      /** Expected amount in smallest unit */
      amount: string
      /** Expected currency/token identifier */
      currency: string
      /** Optional payer identifier (DID) */
      source?: string | undefined
      /** Optional server-defined correlation data */
      opaque?: Record<string, string> | undefined
      /** Optional request body digest */
      digest?: string | undefined
    }) => Promise<{ success: boolean; error?: string }>
  } & Defaults

  type DeriveDefaults<parameters extends Parameters> = Pick<
    parameters,
    Extract<keyof parameters, keyof Defaults>
  > & { decimals: number; chainId: string; currency: string }
}
