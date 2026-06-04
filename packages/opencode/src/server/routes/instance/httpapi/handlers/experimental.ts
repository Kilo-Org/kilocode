import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge" // kilocode_change
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { ToolRegistry } from "@/tool/registry"
import * as EffectZod from "@opencode-ai/core/effect-zod"
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
  WorktreeDiffFileQuery,
  WorktreeDiffQuery,
} from "../groups/experimental"

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service

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
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.get(yield* agents.defaultAgent()),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: EffectZod.toJsonSchema(item.parameters),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: Worktree.CreateInput | undefined
    }) {
      return yield* worktreeSvc.create(ctx.payload)
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* worktreeSvc.remove(input.payload)
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* worktreeSvc.reset(ctx.payload)
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
      const directories = ctx.query.worktrees ? yield* WorktreeFamily.list() : undefined
      const sorted = directories ? [...directories].sort((a, b) => b.length - a.length) : undefined
      // kilocode_change end
      const sessions = Array.from(
        Session.listGlobal({
          projectID, // kilocode_change
          directory: ctx.query.worktrees ? undefined : ctx.query.directory, // kilocode_change
          directories, // kilocode_change
          roots: ctx.query.roots,
          start: ctx.query.start,
          cursor: ctx.query.cursor,
          search: ctx.query.search,
          limit: limit + 1,
          archived: ctx.query.archived,
        }),
      )
      // kilocode_change start - resolve worktree folder name for each session
      const result = sorted
        ? sessions.map((session) => {
            const root = sorted.find((dir) => Filesystem.contains(dir, session.directory))
            return { ...session, worktreeName: path.basename(root ?? session.directory) }
          })
        : sessions
      const list = result.length > limit ? result.slice(0, limit) : result
      // kilocode_change end
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          result.length > limit && list.length > 0 // kilocode_change
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return (
      handlers
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
        .handle("resource", resource)
    )
  }),
)
