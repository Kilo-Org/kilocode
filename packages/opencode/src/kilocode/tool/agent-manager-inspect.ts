// kilocode_change - new file
import { Bus } from "@/bus"
import { AgentManagerInspectBridge } from "@/kilocode/agent-manager/inspect"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./agent-manager-inspect.txt"

export const Params = Schema.Struct({
  sessionID: Schema.String.annotate({ description: "Existing Agent Manager session ID to inspect" }),
  tail: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(50))).annotate({
    description: "Optional bounded number of recent messages to include (max 50)",
  }),
})

export const AgentManagerInspectTool = Tool.define<
  typeof Params,
  { requestID: string; sessionID: string },
  Bus.Service,
  "agent_manager_inspect"
>(
  "agent_manager_inspect",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "agent_manager",
            patterns: ["inspect", params.sessionID],
            always: ["inspect"],
            metadata: { action: "inspect", target: params.sessionID },
          })

          const requestID = `am-inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const output = yield* AgentManagerInspectBridge.request(bus, {
            requestID,
            sessionID: ctx.sessionID,
            targetSessionID: params.sessionID,
            ...(params.tail ? { tail: params.tail } : {}),
            abort: ctx.abort,
          })

          return {
            title: `Inspected Agent Manager session ${params.sessionID}`,
            output,
            metadata: { requestID, sessionID: params.sessionID },
          }
        }),
    }
  }),
)
