import { Slug } from "@opencode-ai/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import { SyncEvent } from "../sync"
import type { SQL } from "../storage/db"
import { SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage/storage"
import { Log } from "../util/log"
import { updateSchema } from "../util/update-schema"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"
import { Filesystem } from "../util/filesystem" // kilocode_change: normalize directory for Windows drive-letter casing

import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"
import { Global } from "@/global"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { iife } from "@/util/iife"

export namespace Session {
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

  // kilocode_change start
  function family(id: string) {
    const row = Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, ProjectID.make(id)))
        .get(),
    )
    const root = row?.worktree ? Filesystem.resolve(row.worktree) : undefined
    if (!root || root === "/") return [id]
    const ids = Database.use((db) =>
      db
        .select({ id: ProjectTable.id })
        .from(ProjectTable)
        .where(eq(ProjectTable.worktree, root))
        .all()
        .map((item) => item.id),
    )
    return ids.length ? ids : [id]
  }
  // kilocode_change end

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
          // kilocode_change start - lightweight diff summary (no file contents)
          diffs: z
            .array(
              z.object({
                file: z.string(),
                additions: z.number(),
                deletions: z.number(),
                status: z.enum(["added", "deleted", "modified"]).optional(),
              }),
            )
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
      permission: Permission.Ruleset.optional(),
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
    TurnOpen: BusEvent.define(
      "session.turn.open",
      z.object({
        sessionID: z.string(),
      }),
    ),
    TurnClose: BusEvent.define(
      "session.turn.close",
      z.object({
        sessionID: z.string(),
        reason: z.enum(["completed", "error", "interrupted"]),
      }),
    ),
    // kilocode_change end
  }

  // kilocode_change
  export type CloseReason = z.infer<typeof Event.TurnClose.properties>["reason"]

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        platform: z.string().optional(), // kilocode_change - per-session platform override for telemetry attribution
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    async (input) => {
      const session = await createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID,
      })
      // kilocode_change start - store platform override for session ingest
      if (input?.platform) {
        platformOverrides.set(session.id, input.platform)
      }
      // kilocode_change end
      return session
    },
  )

  // kilocode_change start - per-session platform overrides for telemetry attribution
  const platformOverrides = new Map<string, string>()

  export function getPlatformOverride(sessionId: string): string | undefined {
    return platformOverrides.get(sessionId)
  }
  // kilocode_change end

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const time = Date.now()
    SyncEvent.run(Event.Updated, { sessionID, info: { time: { updated: time } } })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    workspaceID?: WorkspaceID
    directory: string
    permission?: Permission.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
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

    SyncEvent.run(Event.Created, { sessionID: result.id, info: result })

    const cfg = await Config.get()
    if (!result.parentID && (Flag.KILO_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch(() => {
        // Silently ignore sharing errors during session creation
      })

    if (!Flag.KILO_EXPERIMENTAL_WORKSPACES) {
      // This only exist for backwards compatibility. We should not be
      // manually publishing this event; it is a sync event now
      Bus.publish(Event.Updated, {
        sessionID: result.id,
        info: result,
      })
    }

    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".kilo", "plans") // kilocode_change
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions") // kilocode_change
    const share = await KiloSessions.share(id) // kilocode_change

    SyncEvent.run(Event.Updated, { sessionID: id, info: { share: { url: share.url } } })

    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions") // kilocode_change
    await KiloSessions.unshare(id) // kilocode_change

    SyncEvent.run(Event.Updated, { sessionID: id, info: { share: { url: null } } })
  })

  export const setTitle = fn(
    z.object({
      sessionID: SessionID.zod,
      title: z.string(),
    }),
    async (input) => {
      SyncEvent.run(Event.Updated, { sessionID: input.sessionID, info: { title: input.title } })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: SessionID.zod,
      time: z.number().optional(),
    }),
    async (input) => {
      SyncEvent.run(Event.Updated, { sessionID: input.sessionID, info: { time: { archived: input.time } } })
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: SessionID.zod,
      permission: Permission.Ruleset,
    }),
    async (input) => {
      SyncEvent.run(Event.Updated, {
        sessionID: input.sessionID,
        info: { permission: input.permission, time: { updated: Date.now() } },
      })
    },
  )

  export const setRevert = fn(
    z.object({
      sessionID: SessionID.zod,
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      SyncEvent.run(Event.Updated, {
        sessionID: input.sessionID,
        info: {
          summary: input.summary,
          time: { updated: Date.now() },
          revert: input.revert,
        },
      })
    },
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) => {
    SyncEvent.run(Event.Updated, {
      sessionID,
      info: {
        time: { updated: Date.now() },
        revert: null,
      },
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: SessionID.zod,
      summary: Info.shape.summary,
    }),
    async (input) => {
      SyncEvent.run(Event.Updated, {
        sessionID: input.sessionID,
        info: {
          time: { updated: Date.now() },
          summary: input.summary,
        },
      })
    },
  )

  export const diff = fn(SessionID.zod, async (sessionID) => {
    try {
      return await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    } catch {
      return []
    }
  })

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[]
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export function* list(input?: {
    directory?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    }
    if (input?.directory) {
      // kilocode_change start: vscode uri.fsPath gives lowercase drive letter on Windows; resolve() canonicalises to match stored path
      conditions.push(eq(SessionTable.directory, Filesystem.resolve(input.directory)))
      // kilocode_change end
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

  // kilocode_change start
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
    const conditions: SQL[] = [] // kilocode_change

    // kilocode_change start
    if (input?.projectID) {
      const ids = family(input.projectID)
      if (ids.length === 1 && ids[0] === input.projectID) {
        conditions.push(eq(SessionTable.project_id, ProjectID.make(input.projectID)))
      } else {
        conditions.push(
          inArray(
            SessionTable.project_id,
            ids.map((id) => ProjectID.make(id)),
          ),
        )
      }
    }
    // kilocode_change end

    if (input?.directory) {
      // kilocode_change start: vscode uri.fsPath gives lowercase drive letter on Windows; resolve() canonicalises to match stored path
      conditions.push(eq(SessionTable.directory, Filesystem.resolve(input.directory)))
      // kilocode_change end
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100 // kilocode_change
    // kilocode_change start
    const dirs = [...new Set((input?.directories ?? []).map((dir) => Filesystem.resolve(dir)))]

    const rows = Database.use((db) => {
      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      const sorted = query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      return dirs.length ? sorted.all() : sorted.limit(limit).all()
    })

    const list =
      dirs.length > 0
        ? rows.filter((row) => {
            const dir = Filesystem.resolve(row.directory)
            return dirs.some((root) => Filesystem.contains(root, dir))
          })
        : rows

    const ids = [...new Set(list.slice(0, limit).map((row) => row.project_id))]
    const projects = new Map<string, ProjectInfo>()

    if (ids.length > 0) {
      const items = Database.use((db) =>
        db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all(),
      )
      for (const item of items) {
        projects.set(item.id, {
          id: item.id,
          name: item.name ?? undefined,
          worktree: item.worktree,
        })
      }
    }
    // kilocode_change end

    // kilocode_change start
    for (const row of list.slice(0, limit)) {
      const project = projects.get(row.project_id) ?? null
      yield { ...fromRow(row), project }
    }
    // kilocode_change end
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions") // kilocode_change
      await KiloSessions.remove(sessionID).catch(() => {}) // kilocode_change
      platformOverrides.delete(sessionID) // kilocode_change - clean up platform override
      // kilocode_change start - cancel running processor before deleting to avoid FK constraint errors
      SessionPrompt.cancel(sessionID)
      // kilocode_change end

      SyncEvent.run(Event.Deleted, { sessionID, info: session })

      // Eagerly remove event sourcing data to free up space
      SyncEvent.remove(sessionID)
    } catch (e) {
      log.error(e)
    }
  })

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    // kilocode_change start - ignore FK errors when session was deleted while processor was still running
    try {
      SyncEvent.run(MessageV2.Event.Updated, {
        sessionID: msg.sessionID,
        info: msg,
      })
    } catch (e: any) {
      if (e?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        log.warn("skipping message update for deleted session", { id: msg.id, sessionID: msg.sessionID })
      } else {
        throw e
      }
    }
    // kilocode_change end
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      SyncEvent.run(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      SyncEvent.run(MessageV2.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    },
  )

  const UpdatePartInput = MessageV2.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    // kilocode_change start - ignore FK errors when session was deleted while processor was still running
    try {
      SyncEvent.run(MessageV2.Event.PartUpdated, {
        sessionID: part.sessionID,
        part: structuredClone(part),
        time: Date.now(),
      })
    } catch (e: any) {
      if (e?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        log.warn("skipping part update for deleted session", { id: part.id, sessionID: part.sessionID })
      } else {
        throw e
      }
    }
    // kilocode_change end
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(MessageV2.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
      provider: z.custom<Provider.Info>().optional(), // kilocode_change
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like OpenCode's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      // kilocode_change start - Use provider-reported cost when available for OpenRouter/Kilo
      // The OpenRouter AI SDK provider exposes cost at providerMetadata.openrouter.usage
      // Reference: https://openrouter.ai/docs/use-cases/usage-accounting
      // Note: The AI SDK uses camelCase (upstreamInferenceCost), not snake_case
      const openrouterUsage = input.metadata?.["openrouter"]?.["usage"] as
        | {
            cost?: number
            costDetails?: { upstreamInferenceCost?: number }
          }
        | undefined

      if (openrouterUsage) {
        // For Kilo provider (BYOK), always prefer upstreamInferenceCost when available
        // The 'cost' field from OpenRouter is just their 5% fee for BYOK requests
        // For regular OpenRouter, use the cost field
        const isKiloProvider = (input.provider?.id ?? input.model.providerID) === "kilo"
        const upstreamCost = openrouterUsage.costDetails?.upstreamInferenceCost
        const openrouterCost = openrouterUsage.cost

        // Kilo is always BYOK, so prefer upstream cost. For OpenRouter, use regular cost.
        const providerCost = isKiloProvider && upstreamCost !== undefined ? upstreamCost : openrouterCost

        if (providerCost !== undefined && providerCost !== null && Number.isFinite(providerCost)) {
          return {
            cost: safe(providerCost),
            tokens,
          }
        }
      }
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
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
