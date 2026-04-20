// kilocode_change - new file
import { remapChildren as _remapChildren } from "./fork"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { MessageID, SessionID } from "@/session/schema"
import { makeRuntime } from "@/effect/run-service"
import { fn } from "@/util/fn"
import { Database, eq, and, gte, isNull, desc, like, inArray, lt, or } from "@/storage/db"
import type { SQL } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { Filesystem } from "@/util/filesystem"
import { SessionTable } from "@/session/session.sql"
import { Log } from "@/util/log"
import type { ProviderMetadata } from "ai"
import type { Provider } from "@/provider/provider"

export namespace KiloSession {
  const log = Log.create({ service: "session.kilo" })

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  export const Event = {
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
  }

  export type CloseReason = z.infer<typeof Event.TurnClose.properties>["reason"]

  // ---------------------------------------------------------------------------
  // Per-session platform override (telemetry attribution)
  // ---------------------------------------------------------------------------

  const overrides = new Map<string, string>()

  export function setPlatformOverride(id: string, platform: string) {
    overrides.set(id, platform)
  }

  export function getPlatformOverride(id: string): string | undefined {
    return overrides.get(id)
  }

  export function clearPlatformOverride(id: string) {
    overrides.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Project family resolution (worktree-aware)
  // ---------------------------------------------------------------------------

  export function family(id: string): string[] {
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

  export function filters(input: { projectID: ProjectID; directory?: string }): SQL[] {
    const dir = input.directory ? Filesystem.resolve(input.directory) : undefined
    if (!dir) return [eq(SessionTable.project_id, input.projectID)]
    return [
      or(eq(SessionTable.project_id, input.projectID), eq(SessionTable.directory, dir)),
      eq(SessionTable.directory, dir),
    ].filter((item): item is SQL => item !== undefined)
  }

  // ---------------------------------------------------------------------------
  // Provider-reported cost (OpenRouter / Kilo)
  // ---------------------------------------------------------------------------

  /**
   * Extract provider-reported cost from OpenRouter metadata when available.
   * For the Kilo provider (BYOK), prefers `upstreamInferenceCost` over the
   * regular `cost` field (which is just the OpenRouter 5% fee).
   *
   * Returns `undefined` when no provider cost is available, so the caller
   * should fall back to the standard token-based calculation.
   *
   * Reference: https://openrouter.ai/docs/use-cases/usage-accounting
   */
  export function providerCost(input: {
    metadata?: ProviderMetadata
    provider?: Provider.Info
    providerID: string
  }): number | undefined {
    const openrouterUsage = input.metadata?.["openrouter"]?.["usage"] as
      | {
          cost?: number
          costDetails?: { upstreamInferenceCost?: number }
        }
      | undefined

    if (!openrouterUsage) return undefined

    const isKilo = (input.provider?.id ?? input.providerID) === "kilo"
    const upstream = openrouterUsage.costDetails?.upstreamInferenceCost
    const regular = openrouterUsage.cost

    // Kilo is always BYOK, so prefer upstream cost. For OpenRouter, use regular cost.
    const cost = isKilo && upstream !== undefined ? upstream : regular

    if (cost !== undefined && cost !== null && Number.isFinite(cost)) return cost
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle hooks (share, unshare, remove)
  // ---------------------------------------------------------------------------

  export async function shareSession(id: string): Promise<{ url: string }> {
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
    return KiloSessions.share(id)
  }

  export async function unshareSession(id: string): Promise<void> {
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
    await KiloSessions.unshare(id)
  }

  export async function removeSession(id: string): Promise<void> {
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
    await KiloSessions.remove(id).catch(() => {})
  }

  export async function cleanup(id: string): Promise<void> {
    await removeSession(id)
    clearPlatformOverride(id)
    const [app, state] = await Promise.all([import("@/effect/app-runtime"), import("@/session/run-state")])
    const { SessionID } = await import("@/session/schema")
    await app.AppRuntime.runPromise(state.SessionRunState.Service.use((svc) => svc.cancel(SessionID.make(id))))
  }

  // ---------------------------------------------------------------------------
  // FK-safe SyncEvent wrappers
  //
  // When a session is deleted while the processor is still running, the
  // SyncEvent.run call will throw a SQLITE_CONSTRAINT_FOREIGNKEY error.
  // These helpers catch that specific error and log a warning instead.
  // ---------------------------------------------------------------------------

  export function runSyncSafe(run: () => void, context: { type: string; id: string; sessionID: string }): void {
    try {
      run()
    } catch (e: any) {
      if (e?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        log.warn(`skipping ${context.type} for deleted session`, { id: context.id, sessionID: context.sessionID })
        return
      }
      throw e
    }
  }

  // ---------------------------------------------------------------------------
  // listGlobal — cross-project session listing
  // ---------------------------------------------------------------------------

  /** Schema for project summary returned by listGlobal. */
  export const ProjectInfo = z
    .object({
      id: ProjectID.zod,
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({ ref: "ProjectSummary" })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  type SessionRow = typeof SessionTable.$inferSelect

  /**
   * List sessions across all projects with optional filtering.
   * The `fromRow` callback converts a DB row into a Session.Info;
   * it is injected to avoid a circular dependency on Session.
   */
  export function* listGlobal<T extends { time: { updated: number }; project?: ProjectInfo | null }>(input: {
    fromRow: (row: SessionRow) => Omit<T, "project">
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
    const conditions: SQL[] = []

    if (input.projectID) {
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

    if (input.directory) {
      conditions.push(eq(SessionTable.directory, Filesystem.resolve(input.directory)))
    }
    if (input.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }

    const limit = input.limit ?? 100
    const dirs = [...new Set((input.directories ?? []).map((dir) => Filesystem.resolve(dir)))]

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

    for (const row of list.slice(0, limit)) {
      const project = projects.get(row.project_id) ?? null
      yield { ...input.fromRow(row), project } as T & { project: ProjectInfo | null }
    }
  }

  export const remapChildren = _remapChildren
}

export const kiloSessionFork = fn(
  z.object({ sessionID: SessionID.zod, messageID: MessageID.zod.optional() }),
  async (input) => {
    const { runPromise } = makeRuntime(Session.Service, Session.defaultLayer)
    const session = await runPromise((svc) => svc.fork(input))
    await KiloSession.remapChildren(session.id)
    return session
  },
)
