// kilocode_change - new file
import { AgentManagerInspectBridge } from "@/kilocode/agent-manager/inspect"
import { AgentManagerControlBridge } from "@/kilocode/agent-manager/control"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const inspect = Effect.fn("KilocodeHttpApi.agentManagerInspectRespond")(function* (ctx: {
      payload: typeof AgentManagerInspectBridge.Response.Type
    }) {
      return AgentManagerInspectBridge.respond(ctx.payload)
    })
    const control = Effect.fn("KilocodeHttpApi.agentManagerControlRespond")(function* (ctx: {
      payload: typeof AgentManagerControlBridge.Response.Type
    }) {
      return AgentManagerControlBridge.respond(ctx.payload)
    })

    return handlers.handle("agentManagerControlRespond", control).handle("agentManagerInspectRespond", inspect)
  }),
)
