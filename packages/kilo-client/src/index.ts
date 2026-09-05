import { OpenCode, type RpcCallOptions } from "@opencode-ai/client"
import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { KiloSession } from "@opencode-ai/schema/kilocode/session"
import { Schema } from "effect"

export type ClientOptions = Parameters<typeof OpenCode.make>[0]
export type RequestOptions = Omit<RpcCallOptions, "location">
export type { RpcCallOptions } from "@opencode-ai/client"
export type KiloGatewayAccount = KiloGateway.Account
export type KiloGatewayAccountBalance = KiloGateway.AccountBalance
export type KiloSessionForkInput = typeof KiloSession.ForkInput.Encoded

export function createClient(options: ClientOptions) {
  const client = OpenCode.make(options)
  const gateway = client.rpc(KiloGateway.Definition)
  const sessions = client.rpc(KiloSession.Definition)
  return {
    ...client,
    kilocode: {
      profile: (options?: RpcCallOptions) => gateway.profile({}, options),
      balance: (options?: RpcCallOptions) => gateway.balance({}, options),
      organization: {
        set: (input: KiloGateway.OrganizationSelection, options?: RpcCallOptions) =>
          gateway["organization.set"](input, options),
      },
      session: {
        share: async (input: { sessionID: string }, options?: RpcCallOptions) => {
          const data = await client.session.export({ sessionID: input.sessionID }, options)
          const decoded = await Schema.decodeUnknownPromise(KiloSession.ShareInput)({ ...input, data })
          return sessions.share(Schema.encodeSync(KiloSession.ShareInput)(decoded), options)
        },
        unshare: async (input: { sessionID: string }, options?: RpcCallOptions) => {
          await sessions.unshare(input, options)
        },
        fork: (input: KiloSessionForkInput, options?: RpcCallOptions) => sessions.fork(input, options),
      },
    },
  }
}
