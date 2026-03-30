import { Errors, Method } from 'mppx'
import * as Methods from '../Methods.js'

export function subscription<const parameters extends subscription.Parameters>(parameters: parameters) {
  const { amount, decimals, description, externalId, metadata, chainId, currency, interval, verifyTransaction } =
    parameters

  type Defaults = subscription.DeriveDefaults<parameters>
  return Method.toServer<typeof Methods.subscription, Defaults>(Methods.subscription, {
    defaults: {
      amount,
      decimals,
      description,
      externalId,
      metadata,
      chainId,
      currency,
      interval,
    } as unknown as Defaults,

    async verify({ credential }) {
      const { challenge } = credential
      const parsed = Methods.subscription.schema.credential.payload.safeParse(credential.payload)
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
        interval: challenge.request.interval as string,
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

export declare namespace subscription {
  type Defaults = Omit<Method.RequestDefaults<typeof Methods.subscription>, 'recipient'>

  type Parameters = {
    verifyTransaction: (parameters: {
      txHash: string
      sender: string
      challengeId: string
      amount: string
      currency: string
      interval: string
      source?: string | undefined
      opaque?: Record<string, string> | undefined
      digest?: string | undefined
    }) => Promise<{ success: boolean; error?: string }>
  } & Defaults

  type DeriveDefaults<parameters extends Parameters> = Pick<
    parameters,
    Extract<keyof parameters, keyof Defaults>
  > & { decimals: number; chainId: string; currency: string; interval: string }
}
