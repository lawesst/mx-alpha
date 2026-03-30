import { Challenge, Credential, Method, z } from 'mppx'
import * as Methods from '../Methods.js'

export function session(parameters: session.Parameters) {
  const { signAndSendTransaction, externalId } = parameters

  return Method.toClient(Methods.session, {
    context: z.object({
      sender: z.string(),
    }),

    async createCredential({ challenge, context }) {
      const sender = context.sender
      const amount = challenge.request.amount as string
      const currency = challenge.request.currency as string
      const duration = challenge.request.duration as string
      const chainId = challenge.request.methodDetails?.chainId as string | undefined
      const recipient = challenge.request.recipient as string

      const res = await signAndSendTransaction({
        amount,
        challenge,
        currency,
        duration,
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

export declare namespace session {
  type Parameters = {
    signAndSendTransaction: (parameters: OnChallengeParameters) => Promise<{ txHash: string; sender: string }>
    externalId?: string | undefined
  }

  type OnChallengeParameters = {
    amount: string
    challenge: Challenge.Challenge<
      z.output<typeof Methods.session.schema.request>,
      typeof Methods.session.intent,
      typeof Methods.session.name
    >
    currency: string
    duration: string
    chainId?: string | undefined
    sender: string
    recipient: string
  }
}
