import { define } from "@opencode/plugin/effect/plugin"
import { KiloCloudHistoryRpc } from "@opencode/schema/kilocode/cloud-history"
import { Effect } from "effect"
import { KiloGatewayAccounts } from "../gateway/accounts"
import { CloudError, reader } from "./reader"
import { transfer } from "./transfer"

export const KiloCloudHistory = define({
  id: "kilocode.cloud-history",
  effect: Effect.fn(function* (ctx) {
    const open = (signal: AbortSignal) => reader(() => KiloGatewayAccounts.get(ctx.location.directory), signal)
    const message = (cause: unknown) =>
      cause instanceof CloudError ? cause.message : "Unable to read native Kilo Cloud history. Retry the request."
    yield* ctx.rpc
      .register(KiloCloudHistoryRpc.Definition, {
        capabilities: () => Effect.succeed({ repositoryFilter: false, publicLinks: false }),
        list: (input, rpc) =>
          Effect.tryPromise({
            try: async (signal) => (await open(signal)).list(input),
            catch: (cause) => rpc.error("failed", message(cause)),
          }),
        download: (input, rpc) =>
          Effect.tryPromise({
            try: async (signal) => transfer(await (await open(signal)).snapshot(input.sessionID), ctx.location),
            catch: (cause) => rpc.error("failed", message(cause)),
          }),
      })
      .pipe(Effect.orDie)
  }),
})
