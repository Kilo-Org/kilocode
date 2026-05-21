import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Agent } from "@/agent/agent"
import { EffectBridge } from "@/effect/bridge"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import { RemoveAgentPayload, RemoveSkillPayload } from "../groups/kilocode"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const heapSnapshot = Effect.fn("KilocodeHttpApi.heapSnapshot")(function* () {
      return yield* Effect.sync(() => HeapSnapshot.write())
    })

    const removeSkill = Effect.fn("KilocodeHttpApi.removeSkill")(function* (ctx: {
      payload: typeof RemoveSkillPayload.Type
    }) {
      yield* Effect.promise(() => Skill.remove(ctx.payload.location))
      return true
    })

    const removeAgent = Effect.fn("KilocodeHttpApi.removeAgent")(function* (ctx: {
      payload: typeof RemoveAgentPayload.Type
    }) {
      yield* EffectBridge.fromPromise(() => Agent.remove(ctx.payload.name))
      return true
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
  }),
)
