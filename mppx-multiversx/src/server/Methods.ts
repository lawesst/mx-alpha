import * as Charge from './Charge.js'
import * as Session from './Session.js'

export function multiversx(
  parameters: Charge.charge.Parameters,
): ReturnType<typeof Charge.charge> {
  return Charge.charge(parameters)
}

multiversx.charge = Charge.charge
multiversx.session = Session.session

export declare namespace multiversx {
  export type Parameters = Charge.charge.Parameters // typescript namespace workaround for tsup
}
