import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { SessionUsageRpc } from "./session-usage-rpc"
import type { SessionUsageReader } from "./session-usage"

export const SESSION_USAGE_PLUGIN_ID = "kilocode.session-usage"

export type SessionUsagePluginOptions = {
  readonly read: SessionUsageReader
}

/** Exposes durable family usage only for sessions in this exact plugin Location. */
export function createSessionUsagePlugin(options: SessionUsagePluginOptions): Plugin {
  return define({
    id: SESSION_USAGE_PLUGIN_ID,
    effect: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.rpc.register(SessionUsageRpc, {
          get: (input, call) =>
            Effect.gen(function* () {
              const session = yield* ctx.session
                .get({ sessionID: input.sessionID })
                .pipe(Effect.catch(() => Effect.fail(call.error("kilocode.session-usage", "Session is unavailable"))))
              if (
                session.location.directory !== ctx.location.directory ||
                session.location.workspaceID !== ctx.location.workspaceID
              )
                return yield* Effect.fail(call.error("kilocode.session-usage", "Session is unavailable"))
              const usage = yield* options.read({ sessionID: session.id })
              if (!usage) return yield* Effect.fail(call.error("kilocode.session-usage", "Session is unavailable"))
              return usage
            }),
        })
      }).pipe(Effect.orDie),
  })
}
