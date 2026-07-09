import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import * as KiloSkill from "@/kilocode/skill-remove"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import type { RequestID as NotebookRequestID } from "@/kilocode/notebook/protocol"
import { Notebook } from "@/kilocode/notebook/service"
import { ModelUsage } from "@/kilocode/session/model-usage"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import { ProviderUsage } from "@/kilocode/provider-usage"
import type { SessionID } from "@/session/schema"
import { NotebookRejectPayload, NotebookReplyPayload, RemoveAgentPayload, RemoveSkillPayload } from "../groups/kilocode"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const skills = yield* Skill.Service
    const config = yield* Config.Service
    const store = yield* InstanceStore.Service
    const notebook = yield* Notebook.Service
    const usage = yield* ProviderUsage.Service
    const heapSnapshot = Effect.fn("KilocodeHttpApi.heapSnapshot")(function* () {
      return yield* Effect.sync(() => HeapSnapshot.write())
    })

    const agentRequirements = Effect.fn("KilocodeHttpApi.agentRequirements")(function* (ctx: {
      query: { agent: string }
    }) {
      return yield* agents.requirementStatus(ctx.query.agent)
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
      yield* Effect.tryPromise({
        try: () => KiloAgent.remove({ name: ctx.payload.name, agent, dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) => {
          if (KiloAgent.RemoveError.isInstance(err)) return Effect.fail(new HttpApiError.BadRequest({}))
          return Effect.die(err)
        }),
      )
      yield* store.dispose(instance)
      return true
    })

    const providerUsage = Effect.fn("KilocodeHttpApi.providerUsage")(function* () {
      return yield* usage.get().pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
    })

    const providerUsageRefresh = Effect.fn("KilocodeHttpApi.providerUsageRefresh")(function* () {
      return yield* usage.refresh().pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
    })

    const notebookList = Effect.fn("KilocodeHttpApi.notebookList")(function* () {
      return yield* notebook.list()
    })

    const notebookReply = Effect.fn("KilocodeHttpApi.notebookReply")(function* (ctx: {
      params: { requestID: NotebookRequestID }
      payload: typeof NotebookReplyPayload.Type
    }) {
      yield* notebook.reply({ requestID: ctx.params.requestID, result: ctx.payload.result }).pipe(
        Effect.catchTag("Notebook.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
        Effect.catchTag("Notebook.InvalidReplyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      return true
    })

    const notebookReject = Effect.fn("KilocodeHttpApi.notebookReject")(function* (ctx: {
      params: { requestID: NotebookRequestID }
      payload: typeof NotebookRejectPayload.Type
    }) {
      yield* notebook
        .reject({ requestID: ctx.params.requestID, error: ctx.payload.error })
        .pipe(Effect.catchTag("Notebook.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const sessionModelUsage = Effect.fn("KilocodeHttpApi.sessionModelUsage")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const usage = yield* ModelUsage.get(ctx.params.sessionID)
      if (!usage) return yield* new HttpApiError.NotFound({})
      return usage
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("agentRequirements", agentRequirements)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
      .handle("providerUsage", providerUsage)
      .handle("providerUsageRefresh", providerUsageRefresh)
      .handle("notebookList", notebookList)
      .handle("notebookReply", notebookReply)
      .handle("notebookReject", notebookReject)
      .handle("sessionModelUsage", sessionModelUsage)
  }),
)
