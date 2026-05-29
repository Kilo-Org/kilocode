import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import { EffectBridge } from "@/effect/bridge"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { SessionOverview } from "@/kilocode/session/overview"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import { RemoveAgentPayload, RemoveSkillPayload, SessionOverviewQuery } from "../groups/kilocode"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const heapSnapshot = Effect.fn("KilocodeHttpApi.heapSnapshot")(function* () {
      return yield* Effect.sync(() => HeapSnapshot.write())
    })

    const sessionOverview = Effect.fn("KilocodeHttpApi.sessionOverview")(function* (ctx: {
      query: typeof SessionOverviewQuery.Type
    }) {
      return yield* SessionOverview.build(ctx.query)
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
      yield* EffectBridge.fromPromise(() => KiloAgent.remove(ctx.payload.name))
      return true
    })

    return handlers
      .handle("sessionOverview", sessionOverview)
      .handle("heapSnapshot", heapSnapshot)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
  }),
)
