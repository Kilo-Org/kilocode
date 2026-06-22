import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import * as KiloSkill from "@/kilocode/skill-remove"
import * as KiloSkillInstall from "@/kilocode/skills/install"
import * as KiloMarketplace from "@/kilocode/skills/marketplace"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import {
  InstallSkillFolderPayload,
  InstallSkillPayload,
  RemoveAgentPayload,
  RemoveInstalledSkillPayload,
  RemoveSkillPayload,
} from "../groups/kilocode"

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

    const marketplaceSkills = Effect.fn("KilocodeHttpApi.marketplaceSkills")(function* () {
      return yield* Effect.tryPromise({
        try: () => KiloMarketplace.client.skills(),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const installSkill = Effect.fn("KilocodeHttpApi.installSkill")(function* (ctx: {
      payload: typeof InstallSkillPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const result = yield* EffectBridge.fromPromise(() =>
        KiloSkillInstall.install({
          id: ctx.payload.id,
          url: ctx.payload.url,
          scope: ctx.payload.scope,
          workspace: ctx.payload.scope === "project" ? instance.directory : undefined,
        }),
      )
      if (result.success) yield* store.dispose(instance)
      return result
    })

    const removeInstalledSkill = Effect.fn("KilocodeHttpApi.removeInstalledSkill")(function* (ctx: {
      payload: typeof RemoveInstalledSkillPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const result = yield* EffectBridge.fromPromise(() =>
        KiloSkillInstall.remove({
          id: ctx.payload.id,
          scope: ctx.payload.scope,
          workspace: ctx.payload.scope === "project" ? instance.directory : undefined,
        }),
      )
      if (result.success) yield* store.dispose(instance)
      return result
    })

    // kilocode_change start - register a local folder as a skill source
    const installSkillFolder = Effect.fn("KilocodeHttpApi.installSkillFolder")(function* (ctx: {
      payload: typeof InstallSkillFolderPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const cfg = yield* config.get()
      const skills = cfg.skills ?? {}
      const paths = skills.paths ?? []
      // Toggle: if path already present, remove it; otherwise append.
      const next = paths.includes(ctx.payload.path)
        ? paths.filter((p) => p !== ctx.payload.path)
        : [...paths, ctx.payload.path]
      yield* config.update({ ...cfg, skills: { ...skills, paths: next } })
      yield* store.dispose(instance)
      return { success: true, slug: ctx.payload.path }
    })
    // kilocode_change end

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
      .handle("marketplaceSkills", marketplaceSkills)
      .handle("installSkill", installSkill)
      .handle("removeInstalledSkill", removeInstalledSkill)
      .handle("installSkillFolder", installSkillFolder)
  }),
)
