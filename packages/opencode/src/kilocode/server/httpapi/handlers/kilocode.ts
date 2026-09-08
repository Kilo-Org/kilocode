import { Cause, Effect, Scope } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { EventV2Bridge } from "@/event-v2-bridge"
import { KiloSessionContinuation } from "@/kilocode/session/continuation"
import { Suggestion } from "@/kilocode/suggestion"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { mapStorageNotFound } from "@/server/routes/instance/httpapi/handlers/session-errors"
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
import { ConflictError, InvalidRequestError, UnknownError } from "@/server/routes/instance/httpapi/errors"
import { Database } from "@opencode-ai/core/database/database"
import { BoardStore } from "@/kilocode/board/store"
import { Skill } from "@/skill"
import { BackgroundJob } from "@/background/job"
import { SessionRunState } from "@/session/run-state"
import { SessionDrain } from "@/kilocode/session/drain"
import { Drained } from "@opencode-ai/schema/kilocode/session-drain"
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
  ResumeSessionPayload,
  DrainSessionPayload,
  BackgroundJobInfo,
  BackgroundJobsQuery,
  SessionBoardQuery,
  ResetSessionBoardPayload,
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
    const drain = yield* SessionDrain.Service
    const flags = yield* RuntimeFlags.Service
    const locations = yield* LocationServiceMap.Service
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    const scope = yield* Scope.Scope

    const board = <A>(work: Effect.Effect<A, BoardStore.Error | BoardStore.Conflict, Database.Service>) =>
      work.pipe(
        Effect.provideService(Database.Service, database),
        Effect.mapError((error) =>
          error instanceof BoardStore.Conflict
            ? new ConflictError({ message: error.message })
            : error.kind === "storage"
              ? new UnknownError({ message: error.message })
              : new InvalidRequestError({ message: error.message }),
        ),
      )

    const sessionBoard = Effect.fn("KilocodeHttpApi.sessionBoard")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof SessionBoardQuery.Type
    }) {
      yield* mapStorageNotFound(sessions.get(ctx.params.sessionID))
      return yield* board(
        BoardStore.observe({
          ...ctx.query,
          sessionID: ctx.params.sessionID,
          directory: yield* InstanceState.directory,
        }),
      )
    })

    const resetSessionBoard = Effect.fn("KilocodeHttpApi.resetSessionBoard")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ResetSessionBoardPayload.Type
    }) {
      yield* mapStorageNotFound(sessions.get(ctx.params.sessionID))
      return yield* board(
        BoardStore.reset({
          sessionID: ctx.params.sessionID,
          revision: ctx.payload.revision,
          directory: yield* InstanceState.directory,
        }),
      )
    })

    const drainSession = Effect.fn("KilocodeHttpApi.drainSession")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof DrainSessionPayload.Type
    }) {
      yield* mapStorageNotFound(sessions.get(ctx.params.sessionID))
      yield* drain.wait(ctx.params.sessionID)
      yield* events.publish(Drained, { sessionID: ctx.params.sessionID, token: ctx.payload.token })
      return true
    })

    const resumeSession = Effect.fn("KilocodeHttpApi.resumeSession")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ResumeSessionPayload.Type
    }) {
      const id = ctx.params.sessionID
      const session = yield* mapStorageNotFound(sessions.get(id))
      const blocked = new InvalidRequestError({ message: "This session cannot be resumed in its current state." })
      if (session.revert || session.time.archived) return yield* blocked
      yield* runState.assertNotBusy(id).pipe(Effect.mapError(() => blocked))
      if ((yield* status.get(id)).type !== "idle") return yield* blocked
      const pending = [
        ...(yield* permission.list()),
        ...(yield* question.list()),
        ...(yield* Effect.promise(() => Suggestion.list())),
      ]
      if (pending.length > 0) {
        const family = new Set([id])
        for (const parent of family) {
          for (const child of yield* sessions.children(parent)) family.add(child.id)
        }
        if (pending.some((request) => family.has(request.sessionID))) return yield* blocked
      }
      const messages = yield* mapStorageNotFound(sessions.messages({ sessionID: id }))
      if (KiloSessionContinuation.target(messages) !== ctx.payload.messageID) return yield* blocked
      yield* prompt
        .loop({
          sessionID: id,
          resume: ctx.payload.messageID,
          snapshotInitialization: ctx.payload.snapshotInitialization,
        })
        .pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            return Effect.gen(function* () {
              yield* Effect.logError("session resume failed", { sessionID: id, cause })
              yield* events.publish(Session.Event.Error, {
                sessionID: id,
                error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
              })
            })
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      return true
    })

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
      .handle("resumeSession", resumeSession)
      .handle("drainSession", drainSession)
      .handle("sessionBoard", sessionBoard)
      .handle("resetSessionBoard", resetSessionBoard)
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
