import { prepareForkedPart as _prepareForkedPart } from "./fork"
import z from "zod"
import { Cause, Effect, Schema } from "effect"
import { Bus } from "@/bus"
import { Instance, type InstanceContext } from "@/kilocode/instance"
import { EffectBridge } from "@/effect/bridge"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { and, desc, eq, gte, inArray, isNull, like, lt, or, type SQL } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Filesystem } from "@/util/filesystem"
import { SessionTable } from "@opencode-ai/core/session/sql"
import * as Log from "@opencode-ai/core/util/log"
import type { ProviderMetadata, Usage } from "@opencode-ai/llm"
import type { Provider } from "@/provider/provider"
import { ENV_FEATURE } from "@kilocode/kilo-gateway"
import { existsSync } from "fs"
import path from "path"
import { iife } from "@/util/iife"
import { KiloSessionEvent, type KiloSessionCloseReason } from "./event"

export namespace KiloSession {
  const log = Log.create({ service: "session.kilo" })

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  export const Event = KiloSessionEvent
  export type CloseReason = KiloSessionCloseReason

  // Turn events stay on the legacy Bus (memory/turn.ts subscribes there), but the publish
  // lives here so the upstream-shaped session/prompt.ts does not take a legacy Bus dependency.
  export const publishTurnOpen = (input: { sessionID: SessionID }) =>
    Effect.promise(() => Bus.publish(Instance.current, Event.TurnOpen, input))

  export const publishTurnClose = (input: { sessionID: SessionID; parentID?: SessionID; reason: CloseReason }) =>
    Effect.promise(() => Bus.publish(Instance.current, Event.TurnClose, input))

  // FIFO snapshot of the per-session waiting list.
  // Emitted by KiloSessionPromptQueue on every transition that changes the set
  // of queued (not-yet-running) user messages.
  export const publishQueueChanged = (input: { sessionID: SessionID; queued: MessageID[] }) =>
    Effect.promise(() => Bus.publish(Instance.current, Event.QueueChanged, input))

  // Synchronous, fire-and-forget variant for callers that run outside an Effect
  // context (e.g. KiloSessionPromptQueue transitions, which fire from inside
  // Effect.sync blocks). Swallows errors so a transient context loss never
  // breaks the queue.
  export function publishQueueChangedAsync(input: { sessionID: SessionID; queued: MessageID[] }) {
    const ctx = iife((): InstanceContext | undefined => {
      try {
        return Instance.current
      } catch {
        return undefined
      }
    })
    if (!ctx) return
    Bus.publish(ctx, Event.QueueChanged, input).catch(err => log.warn("queue changed publish failed", { err }))
  }

  // ---------------------------------------------------------------------------
  // Per-session platform override (telemetry attribution)
  // ---------------------------------------------------------------------------

  const overrides = new Map<string, string>()
  const parents = new Map<string, string>()
  const roots = new Map<string, string>()

  export function register(input: { id: string; parentID?: string; platform?: string }) {
    const root = input.parentID ? (roots.get(input.parentID) ?? input.parentID) : input.id
    const platform = input.platform ?? (input.parentID ? resolvePlatform(input.parentID) : undefined)

    roots.set(input.id, root)
    if (input.parentID) parents.set(input.id, input.parentID)
    if (platform) overrides.set(input.id, platform)
  }

  export function setPlatformOverride(id: string, platform: string) {
    overrides.set(id, platform)
  }

  export function getPlatformOverride(id: string): string | undefined {
    return overrides.get(id)
  }

  export function resolvePlatform(id: string): string | undefined {
    const override = overrides.get(id)
    if (override) return override
    const parent = parents.get(id)
    if (!parent) return undefined
    return resolvePlatform(parent)
  }

  export function resolveRoot(id: string): string {
    return roots.get(id) ?? id
  }

  export function resolveParent(id: string): string | undefined {
    return parents.get(id)
  }

  export function featureForPlatform(platform: string | undefined): string | undefined {
    switch (platform) {
      case "agent-manager":
        return "agent-manager"
      case "vscode":
        return "vscode-extension"
      case "cli":
        return "cli"
      default:
        return undefined
    }
  }

  export function clearPlatformOverride(id: string) {
    overrides.delete(id)
    parents.delete(id)
    roots.delete(id)
  }

  export function attribution(id: string): { rootID: string; feature?: string } {
    const rootID = resolveRoot(id)
    const platform = resolvePlatform(rootID) ?? process.env["KILO_PLATFORM"]
    const feature = featureForPlatform(platform) ?? process.env[ENV_FEATURE]
    return { rootID, ...(feature ? { feature } : {}) }
  }

  // ---------------------------------------------------------------------------
  // Project family resolution (worktree-aware)
  // ---------------------------------------------------------------------------

  function family(
    id: string,
    rows: Array<Pick<typeof ProjectTable.$inferSelect, "id" | "worktree" | "sandboxes">>,
    directories: string[] = [],
  ): string[] {
    const current = rows.find((row) => row.id === id)
    const root = current?.worktree ? Filesystem.resolve(current.worktree) : undefined
    // Combine the stored root with Git's current sibling worktrees.
    const roots = new Set([...(root && root !== "/" ? [root] : []), ...directories.map(Filesystem.resolve)])
    if (roots.size === 0) return [id]

    // Match both each project's recorded root and its saved worktrees.
    const ids = rows.flatMap((row) => {
      const dirs = [row.worktree, ...row.sandboxes].map(Filesystem.resolve)
      return dirs.some((dir) => roots.has(dir)) ? [row.id] : []
    })
    // Always keep the requested ID and remove duplicates.
    return [...new Set([id, ...ids])]
  }

  export function filters(input: { projectID: ProjectV2.ID; directory?: string }): SQL[] {
    const dir = input.directory ? Filesystem.resolve(input.directory) : undefined
    if (!dir) return [eq(SessionTable.project_id, input.projectID)]
    return [
      or(eq(SessionTable.project_id, input.projectID), eq(SessionTable.directory, dir)),
      eq(SessionTable.directory, dir),
    ].filter((item): item is SQL => item !== undefined)
  }

  // ---------------------------------------------------------------------------
  // Provider-reported cost (Kilo / OpenRouter / Vercel AI Gateway)
  // ---------------------------------------------------------------------------

  /**
   * Extract provider-reported cost from response metadata when available.
   *
   * Supports the following internal transports:
   *   1. OpenRouter chat completions  -> `metadata.openrouter.usage.cost`
   *                                      (`costDetails.upstreamInferenceCost` for Kilo)
   *   2. Anthropic Messages or OpenAI Responses via OpenRouter
   *                                   -> `usage.providerMetadata.aiSdk.cost_details`
   *   3. Anthropic Messages or OpenAI Responses via Vercel AI Gateway
   *                                   -> `metadata.gateway.marketCost`
   *
   * Kilo does not charge end users a per-request fee, so for the Kilo provider the
   * top-level `cost` field (the gateway/marketplace fee) would understate the user's
   * actual upstream spend. Always prefer the upstream/market cost when present.
   *
   * Returns `undefined` when no provider cost is available, so the caller
   * should fall back to the standard token-based calculation.
   *
   * Reference: https://openrouter.ai/docs/cookbook/administration/usage-accounting
   */
  export function providerCost(input: {
    metadata?: ProviderMetadata
    usage?: Usage
    provider?: Provider.Info
    providerID: string
  }): number | undefined {
    const isKilo = (input.provider?.id ?? input.providerID) === "kilo"

    const num = (value: unknown): number | undefined => {
      if (value === undefined || value === null) return undefined
      const n = typeof value === "string" ? Number(value) : (value as number)
      return Number.isFinite(n) ? n : undefined
    }

    // 1. OpenRouter chat completions
    const orUsage = input.metadata?.["openrouter"]?.["usage"] as
      | { cost?: number; costDetails?: { upstreamInferenceCost?: number } }
      | undefined
    if (orUsage) {
      const upstream = num(orUsage.costDetails?.upstreamInferenceCost)
      const regular = num(orUsage.cost)
      // Kilo doesn't charge a fee on top of the upstream inference cost, so for Kilo
      // prefer the upstream cost (the user's true spend). For the OpenRouter provider
      // itself, the regular `cost` field is what the user is billed.
      const cost = isKilo && upstream !== undefined ? upstream : regular
      if (cost !== undefined) return cost
    }

    // 2. Anthropic Messages or OpenAI Responses via OpenRouter. The Kilo Gateway wrapper
    //    restores the verbatim usage payload under the AI SDK's raw usage escape hatch.
    //    Kilo doesn't charge end users a per-request fee, so only upstream cost is relevant.
    const usage = input.usage?.providerMetadata
    const aiSdk = usage?.["aiSdk"]?.["cost_details"] as { upstream_inference_cost?: number } | undefined
    const upstream = num(aiSdk?.upstream_inference_cost)
    if (upstream !== undefined) return upstream

    // 3. Anthropic Messages or OpenAI Responses via Vercel AI Gateway. `cost` is the
    //    gateway fee that Kilo would pass through, but Kilo doesn't charge end users a
    //    per-request fee, so always use `marketCost` (the upstream provider's price).
    //    Values are emitted as strings on the wire.
    const gateway = input.metadata?.["gateway"] as { marketCost?: string | number } | undefined
    const marketCost = num(gateway?.marketCost)
    if (marketCost !== undefined) return marketCost

    return undefined
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle hooks (share, unshare, remove)
  // ---------------------------------------------------------------------------

  export function shareSession(id: SessionID) {
    return EffectBridge.fromPromise(async () => {
      const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
      return KiloSessions.share(id)
    }).pipe(Effect.catchCause((cause) => Effect.fail(Cause.squash(cause))))
  }

  export function unshareSession(id: SessionID) {
    return EffectBridge.fromPromise(async () => {
      const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
      await KiloSessions.unshare(id)
    }).pipe(Effect.catchCause((cause) => Effect.fail(Cause.squash(cause))))
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

  function foreignKey(input: unknown): boolean {
    if (Cause.isCause(input)) {
      return input.reasons.some((reason) => {
        if (Cause.isFailReason(reason)) return foreignKey(reason.error)
        if (Cause.isDieReason(reason)) return foreignKey(reason.defect)
        return false
      })
    }
    if (typeof input !== "object" || input === null) return false
    if ("code" in input && input.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true
    return "cause" in input && foreignKey(input.cause)
  }

  export function runSyncSafe<E, R>(
    run: Effect.Effect<void, E, R>,
    context: { type: string; id: string; sessionID: string },
  ) {
    return run.pipe(
      Effect.catchCause((cause) => {
        if (foreignKey(cause)) {
          return Effect.sync(() =>
            log.warn(`skipping ${context.type} for deleted session`, {
              id: context.id,
              sessionID: context.sessionID,
            }),
          )
        }
        return Effect.failCause(cause)
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // listGlobal — cross-project session listing
  // ---------------------------------------------------------------------------

  /** Schema for project summary returned by listGlobal. */
  export const ProjectInfo = z
    .object({
      id: z.custom<ProjectV2.ID>(Schema.is(ProjectV2.ID)),
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
  export function listGlobal<T extends { time: { updated: number }; project?: ProjectInfo | null }>(input: {
    fromRow: (row: SessionRow) => Omit<T, "project">
    projectID?: string
    directory?: string
    directories?: string[]
    currentDirectory?: string
    roots?: boolean
    start?: number
    cursor?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    return Effect.gen(function* () {
      const { db } = yield* Database.Service
      const conditions: SQL[] = []
      const dirs = [...new Set((input.directories ?? []).map((dir) => Filesystem.resolve(dir)))]

      if (input.projectID) {
        const projects = yield* db
          .select({ id: ProjectTable.id, worktree: ProjectTable.worktree, sandboxes: ProjectTable.sandboxes })
          .from(ProjectTable)
          .all()
          .pipe(Effect.orDie)
        const ids = family(input.projectID, projects, dirs)
        if (ids.length === 1 && ids[0] === input.projectID) {
          conditions.push(eq(SessionTable.project_id, ProjectV2.ID.make(input.projectID)))
        } else {
          conditions.push(
            inArray(
              SessionTable.project_id,
              ids.map((id) => ProjectV2.ID.make(id)),
            ),
          )
        }
      }

      if (input.directory) conditions.push(eq(SessionTable.directory, Filesystem.resolve(input.directory)))
      if (input.roots) conditions.push(isNull(SessionTable.parent_id))
      if (input.start) conditions.push(gte(SessionTable.time_updated, input.start))
      if (input.cursor) conditions.push(lt(SessionTable.time_updated, input.cursor))
      if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
      if (!input.archived) conditions.push(isNull(SessionTable.time_archived))

      const limit = input.limit ?? 100
      const sorted = [...dirs].sort((a, b) => b.length - a.length)
      const nested = (root: string, dir: string): boolean => {
        if (dir === root || !Filesystem.contains(root, dir)) return false
        if (existsSync(path.join(dir, ".git"))) return true
        const parent = path.dirname(dir)
        return parent !== dir && nested(root, parent)
      }
      const worktree = (dir: string) => {
        for (const root of sorted) {
          if (!Filesystem.contains(root, dir) || nested(root, dir)) continue
          const rel = path.relative(root, dir)
          const parts = rel.split(path.sep)
          if ((parts[0] === ".kilo" || parts[0] === ".kilocode") && parts[1] === "worktrees" && parts[2]) {
            return path.join(root, parts[0], parts[1], parts[2])
          }
          return root
        }
      }
      const current = input.currentDirectory ? worktree(Filesystem.resolve(input.currentDirectory)) : undefined

      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      const ordered = query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      const rows = yield* (dirs.length ? ordered.all() : ordered.limit(limit).all()).pipe(Effect.orDie)

      const list =
        dirs.length > 0
          ? rows.filter((row) => {
              const dir = Filesystem.resolve(row.directory)
              const root = worktree(dir)
              if (!root) return false
              if (input.currentDirectory) return root === current
              return true
            })
          : rows

      const ids = [...new Set(list.slice(0, limit).map((row) => row.project_id))]
      const projects = new Map<string, ProjectInfo>()

      if (ids.length > 0) {
        const items = yield* db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all()
          .pipe(Effect.orDie)
        for (const item of items) {
          projects.set(item.id, {
            id: item.id,
            name: item.name ?? undefined,
            worktree: item.worktree,
          })
        }
      }

      return list.slice(0, limit).map((row) => {
        const project = projects.get(row.project_id) ?? null
        return { ...input.fromRow(row), project } as T & { project: ProjectInfo | null }
      })
    })
  }

  export const prepareForkedPart = _prepareForkedPart
}

export { kiloSessionFork } from "./fork-command"
