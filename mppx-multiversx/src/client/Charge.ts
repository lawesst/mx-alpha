import { Challenge, Credential, Method, z } from 'mppx'
import * as Methods from '../Methods.js'

/**
 * Creates a MultiversX charge method intent for usage on the client.
 *
 * Accepts a `signAndSendTransaction` callback that constructs, signs, and sends
 * a MultiversX transaction to the network, returning the transaction hash and sender address.
 *
 * @example
 * ```ts
 * import { multiversx } from 'mppx-multiversx/client'
 *
 * const charge = multiversx.charge({
 *   signAndSendTransaction: async ({ amount, challenge, currency, chainId, sender, recipient }) => {
 *     // logic to construct and sign an ESDT/EGLD transfer with data: mpp:<challenge.id>
 *     // ...
 *     return { txHash: '0x...', sender: 'erd1...' }
 *   },
 * })
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const { signAndSendTransaction, externalId } = parameters

  return Method.toClient(Methods.charge, {
    context: z.object({
      sender: z.string(),
    }),

    async createCredential({ challenge, context }) {
      const sender = context.sender
      const amount = challenge.request.amount as string
      const currency = challenge.request.currency as string
      const chainId = challenge.request.methodDetails?.chainId as string | undefined
      const recipient = challenge.request.recipient as string

      const res = await signAndSendTransaction({
        amount,
        challenge,
        currency,
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

export declare namespace charge {
  type Parameters = {
    /** Called when a MultiversX challenge is received. Sign and send the transaction. */
    signAndSendTransaction: (parameters: OnChallengeParameters) => Promise<{ txHash: string; sender: string }>
    /** Optional client-side external reference ID for the credential payload. */
    externalId?: string | undefined
  }

  type OnChallengeParameters = {
    /** Payment amount (in smallest token unit). */
    amount: string
    challenge: Challenge.Challenge<
      z.output<typeof Methods.charge.schema.request>,
      typeof Methods.charge.intent,
      typeof Methods.charge.name
    >
    /** Token identifier — "EGLD" or ESDT identifier like "USDC-c76f31" */
    currency: string
    /** MultiversX Chain ID (e.g. '1', 'D', 'T') */
    chainId?: string | undefined
    /** Sender address */
    sender: string
    /** Recipient address */
    recipient: string
  }
}
