import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as KiloAgent from "@/kilocode/agent"
import { CommandFiles } from "@/kilocode/command-files"
import * as KiloSkill from "@/kilocode/skill-remove"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import type { RequestID as AgentManagerRequestID } from "@/kilocode/agent-manager/protocol"
import { AgentManager } from "@/kilocode/agent-manager/service"
import type { RequestID as NotebookRequestID } from "@/kilocode/notebook/protocol"
import { Notebook } from "@/kilocode/notebook/service"
import { ModelUsage } from "@/kilocode/session/model-usage"
import { ProviderUsage } from "@opencode-ai/core/kilocode/provider-usage"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"
import { Skill } from "@/skill"
import { BackgroundJob } from "@/background/job"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { KiloSnapshotCleanup } from "@/kilocode/snapshot/cleanup"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import path from "path"
import {
  AgentManagerRejectPayload,
  AgentManagerReplyPayload,
  NotebookRejectPayload,
  NotebookReplyPayload,
  RemoveAgentPayload,
  RemoveCommandPayload,
  RemoveSkillPayload,
  RemoveSnapshotPayload,
  BackgroundJobInfo,
  BackgroundJobsQuery,
} from "../groups/kilocode"

export const kilocodeHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilocode", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const commands = yield* Command.Service
    const skills = yield* Skill.Service
    const config = yield* Config.Service
    const store = yield* InstanceStore.Service
    const manager = yield* AgentManager.Service
    const notebook = yield* Notebook.Service
    const background = yield* BackgroundJob.Service
    const runState = yield* SessionRunState.Service
    const flags = yield* RuntimeFlags.Service
    const locations = yield* LocationServiceMap.Service
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service

    // Location-scoped services, keyed by the request's directory and workspace.
    const located = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make((yield* InstanceState.context).directory),
              workspaceID: yield* WorkspaceRef,
            }),
          ),
        ),
      )
    })

    const heapSnapshot = Effect.fn("KilocodeHttpApi.heapSnapshot")(function* () {
      return yield* Effect.sync(() => HeapSnapshot.write())
    })

    const commandFiles = Effect.fn("KilocodeHttpApi.commandFiles")(function* () {
      const instance = yield* InstanceState.context
      const dirs = yield* config.directories()
      const items = yield* commands.list()
      return yield* Effect.tryPromise({
        try: () => CommandFiles.discover({ commands: items, directories: dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(Effect.catch((err) => Effect.die(err)))
    })

    const removeCommand = Effect.fn("KilocodeHttpApi.removeCommand")(function* (ctx: {
      payload: typeof RemoveCommandPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const dirs = yield* config.directories()
      const items = yield* commands.list()
      const entries = yield* Effect.tryPromise({
        try: () => CommandFiles.discover({ commands: items, directories: dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(Effect.catch((err) => Effect.die(err)))
      yield* Effect.tryPromise({
        try: () => CommandFiles.remove(ctx.payload.location, entries),
        catch: () => new HttpApiError.BadRequest({}),
      })
      yield* store.dispose(instance)
      return true
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
        try: () =>
          KiloAgent.remove({
            name: ctx.payload.name,
            agent,
            dirs,
            directory: instance.directory,
            worktree: instance.worktree,
            scope: ctx.payload.scope,
          }),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) => {
          if (KiloAgent.RemoveError.isInstance(err))
            return Effect.fail(new InvalidRequestError({ message: err.data.message }))
          return Effect.die(err)
        }),
      )
      yield* store.dispose(instance)
      return true
    })

    const removeSnapshot = Effect.fn("KilocodeHttpApi.removeSnapshot")(function* (ctx: {
      payload: typeof RemoveSnapshotPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* KiloSnapshotCleanup.remove({
        root: path.join(Global.Path.data, "snapshot"),
        project: instance.project.id,
        directory: instance.worktree,
        worktree: ctx.payload.worktree,
        fs,
        flock,
      }).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const providerUsage = Effect.fn("KilocodeHttpApi.providerUsage")(function* () {
      return yield* located(ProviderUsage.Service.use((usage) => usage.get())).pipe(
        Effect.mapError(() => new HttpApiError.ServiceUnavailable({})),
      )
    })

    const providerUsageRefresh = Effect.fn("KilocodeHttpApi.providerUsageRefresh")(function* () {
      return yield* located(ProviderUsage.Service.use((usage) => usage.refresh())).pipe(
        Effect.mapError(() => new HttpApiError.ServiceUnavailable({})),
      )
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

    const agentManagerList = Effect.fn("KilocodeHttpApi.agentManagerList")(function* () {
      return yield* manager.list()
    })

    const agentManagerReply = Effect.fn("KilocodeHttpApi.agentManagerReply")(function* (ctx: {
      params: { requestID: AgentManagerRequestID }
      payload: typeof AgentManagerReplyPayload.Type
    }) {
      yield* manager.reply({ requestID: ctx.params.requestID, result: ctx.payload.result }).pipe(
        Effect.catchTag("AgentManager.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
        Effect.catchTag("AgentManager.InvalidReplyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      return true
    })

    const agentManagerReject = Effect.fn("KilocodeHttpApi.agentManagerReject")(function* (ctx: {
      params: { requestID: AgentManagerRequestID }
      payload: typeof AgentManagerRejectPayload.Type
    }) {
      yield* manager
        .reject({ requestID: ctx.params.requestID, error: ctx.payload.error })
        .pipe(Effect.catchTag("AgentManager.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const sessionModelUsage = Effect.fn("KilocodeHttpApi.sessionModelUsage")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const usage = yield* ModelUsage.get(ctx.params.sessionID)
      if (!usage) return yield* new HttpApiError.NotFound({})
      return usage
    })

    const backgroundJobs = Effect.fn("KilocodeHttpApi.backgroundJobs")(function* (ctx: {
      query: typeof BackgroundJobsQuery.Type
    }) {
      return (yield* background.list())
        .filter((job) => job.metadata?.parentSessionId === ctx.query.sessionID)
        .map((job) => ({
          id: job.id,
          type: job.type,
          title: job.title,
          status: job.status,
          started_at: job.started_at,
          completed_at: job.completed_at,
          error: job.error,
          metadata: job.metadata,
        })) satisfies (typeof BackgroundJobInfo.Type)[]
    })

    const backgroundJobCancel = Effect.fn("KilocodeHttpApi.backgroundJobCancel")(function* (ctx: {
      params: { jobID: string }
    }) {
      const job = yield* background.get(ctx.params.jobID)
      if (!job) return yield* new HttpApiError.NotFound({})
      const sessionID = SessionID.make(typeof job.metadata?.sessionId === "string" ? job.metadata.sessionId : job.id)
      yield* runState.cancel(sessionID)
      return true
    })

    const backgroundJobPromote = Effect.fn("KilocodeHttpApi.backgroundJobPromote")(function* (ctx: {
      params: { jobID: string }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const job = yield* background.get(ctx.params.jobID)
      if (!job) return yield* new HttpApiError.NotFound({})
      const promoted = yield* background.promote(ctx.params.jobID)
      return promoted !== undefined
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("commandFiles", commandFiles)
      .handle("removeCommand", removeCommand)
      .handle("removeSkill", removeSkill)
      .handle("removeAgent", removeAgent)
      .handle("removeSnapshot", removeSnapshot)
      .handle("providerUsage", providerUsage)
      .handle("providerUsageRefresh", providerUsageRefresh)
      .handle("notebookList", notebookList)
      .handle("notebookReply", notebookReply)
      .handle("notebookReject", notebookReject)
      .handle("agentManagerList", agentManagerList)
      .handle("agentManagerReply", agentManagerReply)
      .handle("agentManagerReject", agentManagerReject)
      .handle("sessionModelUsage", sessionModelUsage)
      .handle("backgroundJobs", backgroundJobs)
      .handle("backgroundJobCancel", backgroundJobCancel)
      .handle("backgroundJobPromote", backgroundJobPromote)
  }),
)
