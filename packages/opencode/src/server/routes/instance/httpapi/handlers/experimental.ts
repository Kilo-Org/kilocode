import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge" // kilocode_change
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Provider } from "@/provider/provider" // kilocode_change
import { ModelV2 } from "@opencode-ai/core/model" // kilocode_change
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Filesystem } from "@/util/filesystem" // kilocode_change
import { Review } from "@/kilocode/review/review" // kilocode_change
import { WorktreeDiff } from "@/kilocode/review/worktree-diff" // kilocode_change
import { WorktreeFamily } from "@/kilocode/worktree-family" // kilocode_change
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Log from "@opencode-ai/core/util/log" // kilocode_change
import path from "path" // kilocode_change
import { InstanceHttpApi } from "../api"
import {
  ConsoleSwitchPayload,
  SessionListQuery,
  ToolListQuery,
  WorktreeApiError,
  WorktreeDiffFileQuery,
  WorktreeDiffQuery,
} from "../groups/experimental"

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const provider = yield* Provider.Service // kilocode_change
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const capabilities = Effect.fn("ExperimentalHttpApi.capabilities")(function* () {
      return { backgroundSubagents: flags.experimentalBackgroundSubagents }
    })

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      // kilocode_change start
      const found = yield* provider.getModel(ctx.query.provider, ctx.query.model).pipe(Effect.option)
      const model = Option.getOrUndefined(found)
      // kilocode_change end
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: model ? ModelV2.ID.make(model.api.id) : ctx.query.model, // kilocode_change
        family: model?.family, // kilocode_change
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    // kilocode_change start - discover Agent Manager and external git worktrees
    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      const managed = new Set((yield* project.sandboxes(ctx.project.id)).map((dir) => Filesystem.resolve(dir)))
      return yield* mapWorktreeError(worktreeSvc.list()).pipe(
        Effect.map((items) =>
          items.map((item) => ({
            directory: item.directory,
            managed: managed.has(Filesystem.resolve(item.directory)),
          })),
        ),
      )
    })
    // kilocode_change end

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    // kilocode_change start - worktree diff endpoints for agent manager
    const base = Effect.fn("ExperimentalHttpApi.worktreeDiffBase")(function* (input: { base?: string }) {
      if (input.base) return input.base
      return yield* EffectBridge.fromPromise(() => Review.getBaseBranch())
    })

    const worktreeDiff = Effect.fn("ExperimentalHttpApi.worktreeDiff")(function* (ctx: {
      query: typeof WorktreeDiffQuery.Type
    }) {
      const log = Log.create({ service: "worktree-diff" })
      const ref = yield* base(ctx.query)
      const dir = yield* InstanceState.directory
      log.info("computing diff", { dir, base: ref })
      const diffs = yield* Effect.promise(() => WorktreeDiff.full({ dir, base: ref, log }))
      return diffs.map((diff) => ({
        file: diff.file,
        before: diff.before,
        after: diff.after,
        patch: diff.patch,
        additions: diff.additions,
        deletions: diff.deletions,
        status: diff.status,
      }))
    })

    const worktreeDiffSummary = Effect.fn("ExperimentalHttpApi.worktreeDiffSummary")(function* (ctx: {
      query: typeof WorktreeDiffQuery.Type
    }) {
      const log = Log.create({ service: "worktree-diff" })
      const ref = yield* base(ctx.query)
      const dir = yield* InstanceState.directory
      log.info("computing diff summary", { dir, base: ref })
      return yield* Effect.promise(() => WorktreeDiff.summary({ dir, base: ref, log }))
    })

    const worktreeDiffFile = Effect.fn("ExperimentalHttpApi.worktreeDiffFile")(function* (ctx: {
      query: typeof WorktreeDiffFileQuery.Type
    }) {
      const log = Log.create({ service: "worktree-diff" })
      const ref = yield* base(ctx.query)
      const dir = yield* InstanceState.directory
      log.info("computing diff detail", { dir, base: ref, file: ctx.query.file })
      return yield* Effect.promise(() => WorktreeDiff.detail({ dir, base: ref, file: ctx.query.file, log })).pipe(
        Effect.map((item) => item ?? null),
      )
    })
    // kilocode_change end

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      // kilocode_change start
      const state = yield* InstanceState.context
      const projectID = ctx.query.worktrees && !ctx.query.projectID ? state.project.id : ctx.query.projectID
      const roots = ctx.query.worktrees ? yield* WorktreeFamily.list() : undefined
      const directory = ctx.query.current ? ctx.query.directory : undefined
      const sorted = roots ? [...roots].sort((a, b) => b.length - a.length) : undefined
      const current = sorted && directory ? sorted.find((dir) => Filesystem.contains(dir, directory)) : undefined
      // kilocode_change end
      if (roots && directory && !current) return HttpServerResponse.jsonUnsafe([]) // kilocode_change
      const all = yield* sessions.listGlobal({
        projectID, // kilocode_change
        directory: ctx.query.worktrees ? undefined : ctx.query.directory, // kilocode_change
        directories: roots, // kilocode_change
        currentDirectory: directory, // kilocode_change
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      // kilocode_change start - resolve worktree folder name for each session
      const result = sorted
        ? all.map((session) => {
            const root = sorted.find((dir) => Filesystem.contains(dir, session.directory))
            return { ...session, worktreeName: path.basename(root ?? session.directory) }
          })
        : all
      const list = result.length > limit ? result.slice(0, limit) : result
      // kilocode_change end
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          result.length > limit && list.length > 0 // kilocode_change
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return handlers
      .handle("capabilities", capabilities)
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      // kilocode_change start
      .handle("worktreeDiff", worktreeDiff)
      .handle("worktreeDiffSummary", worktreeDiffSummary)
      .handle("worktreeDiffFile", worktreeDiffFile)
      // kilocode_change end
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("resource", resource)
  }),
)
