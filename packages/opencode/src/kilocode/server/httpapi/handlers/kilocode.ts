import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import * as KiloSkill from "@/kilocode/skill-remove"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { Marketplace } from "@/kilocode/marketplace"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { markInstanceForDisposal } from "@/server/routes/instance/httpapi/lifecycle"
import { Skill } from "@/skill"
import { RemoveAgentPayload, RemoveSkillPayload } from "../groups/kilocode"
import type { InstallPayload, UninstallPayload } from "@/kilocode/marketplace/types"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const skills = yield* Skill.Service
    const config = yield* Config.Service
    const store = yield* InstanceStore.Service

    const heapSnapshot = Effect.fn("KilocodeHttpApi.heapSnapshot")(function* () {
      return yield* Effect.sync(() => HeapSnapshot.write())
    })

    const removeSkill = Effect.fn("KilocodeHttpApi.removeSkill")(function* (ctx: {
      payload: typeof RemoveSkillPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const entries = yield* skills.all()
      yield* Effect.tryPromise({
        try: () => KiloSkill.remove(ctx.payload.location, entries),
        catch: () => new HttpApiError.BadRequest({}),
      })
      yield* store.dispose(instance)
      return true
    })

    const removeAgent = Effect.fn("KilocodeHttpApi.removeAgent")(function* (ctx: {
      payload: typeof RemoveAgentPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const agent = yield* agents.get(ctx.payload.name)
      const dirs = yield* config.directories()
      yield* EffectBridge.fromPromise(() =>
        KiloAgent.remove({ name: ctx.payload.name, agent, dirs, directory: instance.directory }),
      )
      yield* store.dispose(instance)
      return true
    })

    const marketplace = Effect.fn("KilocodeHttpApi.marketplace")(function* () {
      const ctx = yield* InstanceState.context
      return yield* Marketplace.data({ directory: ctx.directory, worktree: ctx.worktree })
    })

    const marketplaceInstall = Effect.fn("KilocodeHttpApi.marketplaceInstall")(function* (req: {
      payload: InstallPayload
    }) {
      const ctx = yield* InstanceState.context
      const result = yield* Marketplace.install(req.payload, { directory: ctx.directory, worktree: ctx.worktree })
      if (result.success) yield* markInstanceForDisposal(ctx)
      return result
    })

    const marketplaceUninstall = Effect.fn("KilocodeHttpApi.marketplaceUninstall")(function* (req: {
      payload: UninstallPayload
    }) {
      const ctx = yield* InstanceState.context
      const result = yield* Marketplace.uninstall(req.payload, { directory: ctx.directory, worktree: ctx.worktree })
      if (result.success) yield* markInstanceForDisposal(ctx)
      return result
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
      .handle("marketplace", marketplace)
      .handle("marketplaceInstall", marketplaceInstall)
      .handle("marketplaceUninstall", marketplaceUninstall)
  }),
)
