import type { KiloAccount } from "@kilocode/gateway-core"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError } from "./error"
import { streamSocket } from "./live-broadcast-ticket.js"

const frame = Schema.Struct({
  sessionId: Schema.String,
  streamEventType: Schema.Literal("commands.available"),
  data: Schema.Struct({ commands: KiloHostedRpc.CommandCatalog }),
})

/** On-demand metadata bootstrap. Tickets and non-catalog stream envelopes never leave the plugin. */
export function createCommandCatalog(
  account: KiloAccount.Info,
  origins: { issuer: string; worker: string },
  authorize: (target: KiloHostedRpc.Target, signal: AbortSignal) => Promise<string>,
) {
  return async (target: KiloHostedRpc.Target, abort: AbortSignal) => {
    const signal = AbortSignal.any([abort, AbortSignal.timeout(8000)])
    const control = await authorize(target, signal)
    const ws = await streamSocket(account, origins, control, "commands.available", signal)
    const done = Promise.withResolvers<{ commands: typeof KiloHostedRpc.CommandCatalog.Type }>()
    const fail = () => done.reject(new HostedError("Cloud command catalog is unavailable."))
    const decode = Schema.decodeUnknownOption(Schema.fromJsonString(frame))
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data.length > 2_000_000) return fail()
      const parsed = decode(e.data)
      if (parsed._tag === "Some" && parsed.value.sessionId === control)
        done.resolve({
          commands: parsed.value.data.commands.map((c) => ({
            name: c.name,
            description: c.description,
            hints: c.hints,
          })),
        })
    }
    ws.onclose = fail
    ws.onerror = fail
    signal.addEventListener("abort", fail, { once: true })
    try {
      signal.throwIfAborted()
      return await done.promise
    } finally {
      signal.removeEventListener("abort", fail)
      ws.close()
    }
  }
}
