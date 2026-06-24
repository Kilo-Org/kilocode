import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import { EffectBridge } from "@/effect/bridge"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import { RemoveAgentPayload, RemoveSkillPayload } from "../groups/kilocode"
import { ProviderUsage } from "@/kilocode/provider-usage"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* ProviderUsage.Service
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
      yield* EffectBridge.fromPromise(() => KiloAgent.remove(ctx.payload.name))
      return true
    })

    const providerUsage = Effect.fn("KilocodeHttpApi.providerUsage")(function* () {
      return yield* usage.get().pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
    })

    const providerUsageRefresh = Effect.fn("KilocodeHttpApi.providerUsageRefresh")(function* () {
      return yield* usage.refresh().pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
      .handle("providerUsage", providerUsage)
      .handle("providerUsageRefresh", providerUsageRefresh)
  }),
)
