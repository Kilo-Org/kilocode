import { Slug } from "@opencode-ai/shared/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata, type LanguageModelUsage } from "ai"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"
import { InstallationVersion } from "../installation/version"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like } from "../storage" // kilocode_change - listGlobal delegated to KiloSession
import { SyncEvent } from "../sync"
import { PartTable, SessionTable } from "./session.sql"
import { Storage } from "@/storage"
import { Log } from "../util"
import { updateSchema } from "../util/update-schema"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { InstanceState } from "@/effect"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"

import type { Provider } from "@/provider"
import { Permission } from "@/permission"
import { Global } from "@/global"
import { Effect, Layer, Option, Context } from "effect"
// kilocode_change start - legacy promise helpers + kilocode extensions
import { makeRuntime } from "@/effect/run-service"
import { KiloSession, kiloSessionFork } from "@/kilocode/session"
import { fn } from "@/util/fn"
// kilocode_change end

const log = Log.create({ service: "session" })

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

function createDefaultTitle(isChild = false) {
  return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    version: row.version,
    summary,
    share,
    revert,
    permission: row.permission ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    title: info.title,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    revert: info.revert ?? null,
    permission: info.permission,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

export const Info = z
  .object({
    id: SessionID.zod,
    slug: z.string(),
    projectID: ProjectID.zod,
    workspaceID: WorkspaceID.zod.optional(),
    directory: z.string(),
    parentID: SessionID.zod.optional(),
    summary: z
      .object({
        additions: z.number(),
        deletions: z.number(),
        files: z.number(),
        // kilocode_change start - use lightweight diff schema (without before/after file contents)
        diffs: z
          .object({
            file: z.string(),
            additions: z.number(),
            deletions: z.number(),
            status: z.enum(["added", "deleted", "modified"]).optional(),
          })
          .array()
          .optional(),
        // kilocode_change end
      })
      .optional(),
    share: z
      .object({
        url: z.string(),
      })
      .optional(),
    title: z.string(),
    version: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      compacting: z.number().optional(),
      archived: z.number().optional(),
    }),
    permission: Permission.Ruleset.zod.optional(),
    revert: z
      .object({
        messageID: MessageID.zod,
        partID: PartID.zod.optional(),
        snapshot: z.string().optional(),
        diff: z.string().optional(),
      })
      .optional(),
  })
  .meta({
    ref: "Session",
  })
export type Info = z.output<typeof Info>

export const ProjectInfo = z
  .object({
    id: ProjectID.zod,
    name: z.string().optional(),
    worktree: z.string(),
  })
  .meta({
    ref: "ProjectSummary",
  })
export type ProjectInfo = z.output<typeof ProjectInfo>

export const GlobalInfo = Info.extend({
  project: ProjectInfo.nullable(),
  worktreeName: z.string().optional(), // kilocode_change - basename of the specific worktree directory
}).meta({
  ref: "GlobalSession",
})
export type GlobalInfo = z.output<typeof GlobalInfo>

export const CreateInput = z
  .object({
    parentID: SessionID.zod.optional(),
    title: z.string().optional(),
    permission: Info.shape.permission,
    platform: z.string().optional(), // kilocode_change - per-session platform override for telemetry attribution
    workspaceID: WorkspaceID.zod.optional(),
  })
  .optional()
export type CreateInput = z.output<typeof CreateInput>

export const ForkInput = z.object({ sessionID: SessionID.zod, messageID: MessageID.zod.optional() })
export const GetInput = SessionID.zod
export const ChildrenInput = SessionID.zod
export const RemoveInput = SessionID.zod
export const SetTitleInput = z.object({ sessionID: SessionID.zod, title: z.string() })
export const SetArchivedInput = z.object({ sessionID: SessionID.zod, time: z.number().optional() })
export const SetPermissionInput = z.object({ sessionID: SessionID.zod, permission: Permission.Ruleset.zod })
export const SetRevertInput = z.object({
  sessionID: SessionID.zod,
  revert: Info.shape.revert,
  summary: Info.shape.summary,
})
export const MessagesInput = z.object({ sessionID: SessionID.zod, limit: z.number().optional() })

export const Event = {
  Created: SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Updated: SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: updateSchema(Info).extend({
        share: updateSchema(Info.shape.share.unwrap()).optional(),
        time: updateSchema(Info.shape.time).optional(),
      }),
    }),
    busSchema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Deleted: SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Diff: BusEvent.define(
    "session.diff",
    z.object({
      sessionID: SessionID.zod,
      diff: Snapshot.FileDiff.array(),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    z.object({
      sessionID: SessionID.zod.optional(),
      error: MessageV2.Assistant.shape.error,
    }),
  ),
  // kilocode_change start
  TurnOpen: KiloSession.Event.TurnOpen,
  TurnClose: KiloSession.Event.TurnClose,
  // kilocode_change end
}

export function plan(input: { slug: string; time: { created: number } }) {
  const base = Instance.project.vcs
    ? path.join(Instance.worktree, ".kilo", "plans") // kilocode_change
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: {
  model: Provider.Model
  usage: LanguageModelUsage
  metadata?: ProviderMetadata
  provider?: Provider.Info // kilocode_change
}) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return value
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(
    (input.usage.inputTokenDetails?.cacheWriteTokens ??
      input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
      // google-vertex-anthropic returns metadata under "vertex" key
      // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
      input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
      // @ts-expect-error
      input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
      // @ts-expect-error
      input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
      0) as number,
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  // kilocode_change start - Use provider-reported cost when available for OpenRouter/Kilo
  const reported = KiloSession.providerCost({
    metadata: input.metadata,
    provider: input.provider,
    providerID: input.model.providerID,
  })
  if (reported !== undefined) return { cost: safe(reported), tokens }
  // kilocode_change end

  const costInfo =
    input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}

export class BusyError extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} is busy`)
  }
}

export interface Interface {
  readonly create: (input?: {
    parentID?: SessionID
    title?: string
    permission?: Permission.Ruleset
    platform?: string // kilocode_change - per-session platform override for telemetry attribution
    workspaceID?: WorkspaceID
  }) => Effect.Effect<Info>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Snapshot.FileDiff[]>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[]>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<MessageV2.Part | undefined>
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  readonly updatePartDelta: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    field: string
    delta: string
  }) => Effect.Effect<void>
  /** Finds the first message matching the predicate, searching newest-first. */
  readonly findMessage: (
    sessionID: SessionID,
    predicate: (msg: MessageV2.WithParts) => boolean,
  ) => Effect.Effect<Option.Option<MessageV2.WithParts>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Session") {}

type Patch = z.infer<typeof Event.Updated.schema>["info"]

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const layer: Layer.Layer<Service, never, Bus.Service | Storage.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const storage = yield* Storage.Service

    const createNext = Effect.fn("Session.createNext")(function* (input: {
      id?: SessionID
      title?: string
      parentID?: SessionID
      workspaceID?: WorkspaceID
      directory: string
      permission?: Permission.Ruleset
    }) {
      const ctx = yield* InstanceState.context
      const result: Info = {
        id: SessionID.descending(input.id),
        slug: Slug.create(),
        version: InstallationVersion,
        projectID: ctx.project.id,
        directory: input.directory,
        workspaceID: input.workspaceID,
        parentID: input.parentID,
        title: input.title ?? createDefaultTitle(!!input.parentID),
        permission: input.permission,
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      log.info("created", result)

      yield* Effect.sync(() => SyncEvent.run(Event.Created, { sessionID: result.id, info: result }))

      if (!Flag.KILO_EXPERIMENTAL_WORKSPACES) {
        // This only exist for backwards compatibility. We should not be
        // manually publishing this event; it is a sync event now
        yield* bus.publish(Event.Updated, {
          sessionID: result.id,
          info: result,
        })
      }

      return result
    })

    const get = Effect.fn("Session.get")(function* (id: SessionID) {
      const row = yield* db((d) => d.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      return fromRow(row)
    })

    // kilocode_change start - scope by project_id when instance context is available
    const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
      const ctx = yield* Effect.try({ try: () => Instance.current, catch: () => undefined }).pipe(Effect.option)
      const conditions = [eq(SessionTable.parent_id, parentID)]
      if (Option.isSome(ctx)) conditions.push(eq(SessionTable.project_id, ctx.value.project.id))
      const rows = yield* db((d) =>
        d
          .select()
          .from(SessionTable)
          .where(and(...conditions))
          .all(),
      )
      return rows.map(fromRow)
    })
    // kilocode_change end

    const remove: Interface["remove"] = Effect.fnUntraced(function* (sessionID: SessionID) {
      try {
        const session = yield* get(sessionID)
        const kids = yield* children(sessionID)
        for (const child of kids) {
          yield* remove(child.id)
        }

        // `remove` needs to work in all cases, such as a broken
        // sessions that run cleanup. In certain cases these will
        // run without any instance state, so we need to turn off
        // publishing of events in that case
        const hasInstance = yield* InstanceState.directory.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        )

        // kilocode_change start
        yield* Effect.promise(() => KiloSession.removeSession(sessionID)).pipe(Effect.ignore)
        KiloSession.clearPlatformOverride(sessionID)
        if (hasInstance) {
          void Promise.all([import("@/effect/app-runtime"), import("./run-state")]).then(([app, run]) =>
            app.AppRuntime.runPromise(run.SessionRunState.Service.use((svc) => svc.cancel(sessionID))).catch(() => {}),
          )
        }
        // kilocode_change end
        yield* Effect.sync(() => {
          SyncEvent.run(Event.Deleted, { sessionID, info: session }, { publish: hasInstance })
          SyncEvent.remove(sessionID)
        })
      } catch (e) {
        log.error(e)
      }
    })

    const updateMessage = <T extends MessageV2.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        // kilocode_change start - ignore FK errors when session was deleted while processor was still running
        yield* Effect.sync(() =>
          KiloSession.runSyncSafe(
            () => SyncEvent.run(MessageV2.Event.Updated, { sessionID: msg.sessionID, info: msg }),
            { type: "message update", id: msg.id, sessionID: msg.sessionID },
          ),
        )
        // kilocode_change end
        return msg
      }).pipe(Effect.withSpan("Session.updateMessage"))

    const updatePart = <T extends MessageV2.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        // kilocode_change start - ignore FK errors when session was deleted while processor was still running
        yield* Effect.sync(() =>
          KiloSession.runSyncSafe(
            () =>
              SyncEvent.run(MessageV2.Event.PartUpdated, {
                sessionID: part.sessionID,
                part: structuredClone(part),
                time: Date.now(),
              }),
            { type: "part update", id: part.id, sessionID: part.sessionID },
          ),
        )
        // kilocode_change end
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))

    const getPart: Interface["getPart"] = Effect.fn("Session.getPart")(function* (input) {
      const row = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.id, input.partID),
            ),
          )
          .get(),
      )
      if (!row) return
      return {
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as MessageV2.Part
    })

    const create = Effect.fn("Session.create")(function* (input?: {
      parentID?: SessionID
      title?: string
      permission?: Permission.Ruleset
      platform?: string // kilocode_change - per-session platform override for telemetry attribution
      workspaceID?: WorkspaceID
    }) {
      const directory = yield* InstanceState.directory
      const workspace = yield* InstanceState.workspaceID
      const session = yield* createNext({
        parentID: input?.parentID,
        directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID ?? workspace, // kilocode_change - allow explicit override
      })
      // kilocode_change start - store platform override for session ingest
      if (input?.platform) {
        KiloSession.setPlatformOverride(session.id, input.platform)
      }
      // kilocode_change end
      return session
    })

    const fork = Effect.fn("Session.fork")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const directory = yield* InstanceState.directory
      const original = yield* get(input.sessionID)
      const title = getForkedTitle(original.title)
      const session = yield* createNext({
        directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = yield* messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          yield* updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    })

    const patch = (sessionID: SessionID, info: Patch) =>
      Effect.sync(() => SyncEvent.run(Event.Updated, { sessionID, info }))

    const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } })
    })

    const setTitle = Effect.fn("Session.setTitle")(function* (input: { sessionID: SessionID; title: string }) {
      yield* patch(input.sessionID, { title: input.title })
    })

    const setArchived = Effect.fn("Session.setArchived")(function* (input: { sessionID: SessionID; time?: number }) {
      yield* patch(input.sessionID, { time: { archived: input.time } })
    })

    const setPermission = Effect.fn("Session.setPermission")(function* (input: {
      sessionID: SessionID
      permission: Permission.Ruleset
    }) {
      yield* patch(input.sessionID, { permission: input.permission, time: { updated: Date.now() } })
    })

    const setRevert = Effect.fn("Session.setRevert")(function* (input: {
      sessionID: SessionID
      revert: Info["revert"]
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { summary: input.summary, time: { updated: Date.now() }, revert: input.revert })
    })

    const clearRevert = Effect.fn("Session.clearRevert")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null })
    })

    const setSummary = Effect.fn("Session.setSummary")(function* (input: {
      sessionID: SessionID
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary })
    })

    const diff = Effect.fn("Session.diff")(function* (sessionID: SessionID) {
      return yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", sessionID])
        .pipe(Effect.orElseSucceed((): Snapshot.FileDiff[] => []))
    })

    const messages = Effect.fn("Session.messages")(function* (input: { sessionID: SessionID; limit?: number }) {
      if (input.limit) {
        return MessageV2.page({ sessionID: input.sessionID, limit: input.limit }).items
      }
      return Array.from(MessageV2.stream(input.sessionID)).reverse()
    })

    const removeMessage = Effect.fn("Session.removeMessage")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.Removed, {
          sessionID: input.sessionID,
          messageID: input.messageID,
        }),
      )
      return input.messageID
    })

    const removePart = Effect.fn("Session.removePart")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) {
      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.PartRemoved, {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
        }),
      )
      return input.partID
    })

    const updatePartDelta = Effect.fn("Session.updatePartDelta")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) {
      yield* bus.publish(MessageV2.Event.PartDelta, input)
    })

    /** Finds the first message matching the predicate, searching newest-first. */
    const findMessage = Effect.fn("Session.findMessage")(function* (
      sessionID: SessionID,
      predicate: (msg: MessageV2.WithParts) => boolean,
    ) {
      for (const item of MessageV2.stream(sessionID)) {
        if (predicate(item)) return Option.some(item)
      }
      return Option.none<MessageV2.WithParts>()
    })

    return Service.of({
      create,
      fork,
      touch,
      get,
      setTitle,
      setArchived,
      setPermission,
      setRevert,
      clearRevert,
      setSummary,
      diff,
      messages,
      children,
      remove,
      updateMessage,
      removeMessage,
      removePart,
      updatePart,
      getPart,
      updatePartDelta,
      findMessage,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Storage.defaultLayer))

export function* list(input?: {
  directory?: string
  workspaceID?: WorkspaceID
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}) {
  const project = Instance.project
  const conditions = KiloSession.filters({ projectID: project.id, directory: input?.directory }) // kilocode_change

  if (input?.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input?.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated))
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    yield fromRow(row)
  }
}

// kilocode_change start - delegate to KiloSession.listGlobal (adds projectID worktree family + directories[])
export function* listGlobal(input?: {
  projectID?: string
  directory?: string
  directories?: string[]
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}) {
  yield* KiloSession.listGlobal<GlobalInfo>({ ...input, fromRow })
}
// kilocode_change end

// kilocode_change start - keep legacy promise helpers for Kilo callsites
const { runPromise } = makeRuntime(Service, defaultLayer)

export const create = fn(CreateInput, (input) => runPromise((svc) => svc.create(input)))
export const fork = kiloSessionFork
export const get = fn(GetInput, (id) => runPromise((svc) => svc.get(id)))
export const setTitle = fn(SetTitleInput, (input) => runPromise((svc) => svc.setTitle(input)))
export const setArchived = fn(SetArchivedInput, (input) => runPromise((svc) => svc.setArchived(input)))
export const setPermission = fn(SetPermissionInput, (input) => runPromise((svc) => svc.setPermission(input)))
export const setRevert = fn(SetRevertInput, (input) =>
  runPromise((svc) => svc.setRevert({ sessionID: input.sessionID, revert: input.revert, summary: input.summary })),
)
export const messages = fn(MessagesInput, (input) => runPromise((svc) => svc.messages(input)))
export const children = fn(ChildrenInput, (id) => runPromise((svc) => svc.children(id)))
export const remove = fn(RemoveInput, (id) => runPromise((svc) => svc.remove(id)))
export async function updateMessage<T extends MessageV2.Info>(msg: T): Promise<T> {
  MessageV2.Info.parse(msg)
  return runPromise((svc) => svc.updateMessage(msg))
}

export const removeMessage = fn(z.object({ sessionID: SessionID.zod, messageID: MessageID.zod }), (input) =>
  runPromise((svc) => svc.removeMessage(input)),
)

export const removePart = fn(
  z.object({ sessionID: SessionID.zod, messageID: MessageID.zod, partID: PartID.zod }),
  (input) => runPromise((svc) => svc.removePart(input)),
)

export async function updatePart<T extends MessageV2.Part>(part: T): Promise<T> {
  MessageV2.Part.parse(part)
  return runPromise((svc) => svc.updatePart(part))
}

export const updatePartDelta = fn(
  z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
    partID: PartID.zod,
    field: z.string(),
    delta: z.string(),
  }),
  (input) => runPromise((svc) => svc.updatePartDelta(input)),
)
// kilocode_change end
