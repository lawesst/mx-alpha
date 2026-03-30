import { Challenge, Credential, Method, z } from 'mppx'
import * as Methods from '../Methods.js'

export function subscription(parameters: subscription.Parameters) {
  const { signAndSendTransaction, externalId } = parameters

  return Method.toClient(Methods.subscription, {
    context: z.object({
      sender: z.string(),
    }),

    async createCredential({ challenge, context }) {
      const sender = context.sender
      const amount = challenge.request.amount as string
      const currency = challenge.request.currency as string
      const interval = challenge.request.interval as string
      const chainId = challenge.request.methodDetails?.chainId as string | undefined
      const recipient = challenge.request.recipient as string

      const res = await signAndSendTransaction({
        amount,
        challenge,
        currency,
        interval,
        chainId,
        sender,
        recipient,
      })

      return Credential.serialize({
        challenge,
        payload: {
          txHash: res.txHash,
          sender: res.sender,
          ...(externalId ? { externalId } : {}),
        },
      })
    },
  })
}

export declare namespace subscription {
  type Parameters = {
    signAndSendTransaction: (parameters: OnChallengeParameters) => Promise<{ txHash: string; sender: string }>
    externalId?: string | undefined
  }

  type OnChallengeParameters = {
    amount: string
    challenge: Challenge.Challenge<
      z.output<typeof Methods.subscription.schema.request>,
      typeof Methods.subscription.intent,
      typeof Methods.subscription.name
    >
    currency: string
    interval: string
    chainId?: string | undefined
    sender: string
    recipient: string
  }
}
