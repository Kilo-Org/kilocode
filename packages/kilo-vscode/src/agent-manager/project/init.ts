/**
 * Repository-local state initialization for one Agent Manager project context.
 *
 * Extracted from AgentManagerProvider so the same sequence runs for the
 * active project (full panel wiring follows) and for expanded background
 * projects (state push only). Ordering matters: the git exclude update must
 * land before the persisted state file is read.
 */

import { restoreWorktrees } from "../state-recovery"
import type { ProjectContext, ProjectInitResult } from "./context"
import type { Session } from "@kilocode/sdk/v2/client"
import type { ProjectRef, SessionRef, WorktreeRef } from "./route"
import { sessionToWebview } from "../../kilo-provider-utils"

export type { ProjectSessionView } from "./session-view"
import type { ProjectSessionView } from "./session-view"

/**
 * Subset of {@link SessionProvider} needed to discover and register live
 * project sessions by directory. Kept narrow so project-init stays testable
 * without importing the full provider. Route registration methods are
 * optional so tests and non-Agent-Manager callers can omit them.
 */
export interface ProjectSessionListing {
  listSessions?(dir: string): Promise<Session[]>
  setSessionDirectory(id: string, directory: string): void
  /** Register a project root with the shared route service. */
  registerProjectRoute?(ref: ProjectRef, root: string, generation: number): void
  /** Drop a project and all its session/worktree routes. */
  unregisterProjectRoute?(projectId: string): void
  /** Register a worktree directory under a project. */
  registerWorktreeRoute?(ref: WorktreeRef, directory: string, generation: number): void
  /** Register a session directory under a project (exact routing). */
  registerSessionRoute?(ref: SessionRef, directory: string, generation: number): void
  /** Drop one session route (keeps the raw ambiguity index consistent). */
  unregisterSessionRoute?(ref: SessionRef): void
}

/**
 * Register the project root, every worktree directory, and every persisted
 * managed session with the shared route service. Registered routes let the
 * KiloProvider resolve project-qualified session refs to exact directories
 * and detect ambiguous raw session ids across projects. Safe to call when the
 * listing has no route methods: registration is simply skipped.
 */
function registerProjectRoutes(ctx: ProjectContext, sessions: ProjectSessionListing | undefined): void {
  if (!sessions) return
  const state = ctx.peekState()
  sessions.registerProjectRoute?.({ projectId: ctx.id }, ctx.root, ctx.generation)
  if (state) {
    for (const wt of state.getWorktrees()) {
      if (!wt.path) continue
      sessions.registerWorktreeRoute?.({ projectId: ctx.id, worktreeId: wt.id }, wt.path, ctx.generation)
    }
  }
}

/** Drop all routes for a project (e.g. when it is removed or disposed). */
export function unregisterProjectRoutes(ctx: ProjectContext, sessions: ProjectSessionListing | undefined): void {
  if (!sessions) return
  sessions.unregisterProjectRoute?.(ctx.id)
}

export async function initContextState(
  ctx: ProjectContext,
  log: (...args: unknown[]) => void,
): Promise<ProjectInitResult> {
  return ctx.ensureReady(async (generation) => {
    const manager = ctx.worktreeManager()
    const state = ctx.stateManager()
    await manager.ensureGitExclude().catch((err) => log("Failed to update git exclude:", err))
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    const loaded = await state.load()
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    manager.cleanupOrphanedTempDirs()

    if (loaded.status === "failed" && !(await state.prepareRecovery())) {
      return { ok: false, refsFixed: 0 }
    }
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }

    const infos = await manager.discoverWorktrees().catch((err) => {
      log("Failed to discover worktrees during state recovery:", err)
      return []
    })
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    if (infos.length > 0) {
      const result = restoreWorktrees(state, infos)
      if (result.worktrees > 0 || result.sessions > 0) {
        log(`Recovered ${result.worktrees} worktree(s) and ${result.sessions} session(s) from disk`)
        await state.flush()
      }
    }
    return { ok: true, refsFixed: loaded.refsFixed }
  })
}

/** Register explicit Local/worktree routes for every persisted project session. */
export function registerProjectSessions(
  ctx: ProjectContext,
  sessions:
    | ({
        setSessionDirectory(id: string, directory: string): void
        trackSession(id: string): void
      } & Partial<ProjectSessionListing>)
    | undefined,
): void {
  const state = ctx.peekState()
  if (!state || !sessions) return
  registerProjectRoutes(ctx, sessions)
  for (const session of state.getSessions()) {
    const worktree = session.worktreeId ? state.getWorktree(session.worktreeId) : undefined
    const dir = worktree?.path ?? ctx.root
    sessions.setSessionDirectory(session.id, dir)
    sessions.trackSession(session.id)
    sessions.registerSessionRoute?.({ projectId: ctx.id, sessionId: session.id }, dir, ctx.generation)
  }
}

/**
 * Directories whose root sessions belong to this project: exactly {@link ProjectContext.root}
 * plus the paths of every worktree tracked by this context's state. No active
 * workspace root is ever mixed in, so sessions from unrelated projects cannot
 * leak into the listing.
 */
export function projectDirectories(ctx: ProjectContext): string[] {
  const state = ctx.peekState()
  const dirs = new Set<string>([ctx.root])
  if (state) for (const wt of state.getWorktrees()) if (wt.path) dirs.add(wt.path)
  return [...dirs]
}

/**
 * Collect live root sessions for this project by listing exactly {@link ProjectContext.root}
 * and each of its worktree directories through the SessionProvider. Each
 * returned session is registered with the directory it was listed from before
 * being included, so downstream backend requests route to the correct
 * directory-scoped Instance. Managed placement is preserved separately by
 * {@link registerProjectSessions}, which runs first and pins persisted managed
 * sessions to their worktree paths; re-registering a managed session here with
 * the same worktree path is a no-op.
 *
 * A failed directory listing (e.g. backend not connected, missing worktree)
 * resolves to [] and never erases results from the other directories, so one
 * failure cannot blank the whole project.
 */
export async function collectProjectSessions(
  ctx: ProjectContext,
  sessions: ProjectSessionListing | undefined,
): Promise<ProjectSessionView[]> {
  if (!sessions?.listSessions) {
    ctx.setLiveSessions([])
    return []
  }
  const generation = ctx.generation
  const list = sessions.listSessions
  const state = ctx.peekState()
  // Register the project root and worktree directories before listing so the
  // route service can disambiguate sessions discovered in this project even
  // when a raw session id collides with one in another project.
  registerProjectRoutes(ctx, sessions)
  const dirs = [
    { dir: ctx.root, worktreeId: null },
    ...(state
      ?.getWorktrees()
      .filter((wt) => !!wt.path)
      .map((wt) => ({ dir: wt.path, worktreeId: wt.id })) ?? []),
  ].filter((entry, index, all) => all.findIndex((item) => item.dir === entry.dir) === index)
  const byDir = await Promise.all(
    dirs.map(async (entry) => {
      const items = await list(entry.dir).catch((err) => {
        console.warn(`[Kilo New] Agent Manager: listing sessions for ${entry.dir} failed:`, err)
        return [] as Session[]
      })
      return { ...entry, items }
    }),
  )
  if (ctx.lifecycle === "disposed" || ctx.lifecycle === "disposing") return []
  if (!ctx.isCurrent(generation)) return []
  const seen = new Set<string>()
  const out: ProjectSessionView[] = []
  for (const { dir, worktreeId, items } of byDir) {
    for (const s of items) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      sessions.setSessionDirectory(s.id, dir)
      // Register an exact route for every live session. Re-registering a
      // managed session (already routed by registerProjectSessions) with the
      // same directory is a no-op; a different directory would mean the
      // session moved worktrees, and the latest registration wins.
      sessions.registerSessionRoute?.({ projectId: ctx.id, sessionId: s.id }, dir, generation)
      if (worktreeId) {
        sessions.registerWorktreeRoute?.({ projectId: ctx.id, worktreeId }, dir, generation)
      }
      out.push({ ...sessionToWebview(s), worktreeId })
    }
  }
  return out
}

export async function pushProjectSessions(
  ctx: ProjectContext,
  sessions: ProjectSessionListing | undefined,
  post: (message: { type: "agentManager.projectSessions"; projectId: string; sessions: ProjectSessionView[] }) => void,
): Promise<void> {
  const gone = () => ctx.lifecycle === "disposed" || ctx.lifecycle === "disposing"
  if (gone()) return
  // Skip the backend round trips when the listing is still fresh, but always
  // re-post the cached list: the webview may have mounted after the last push
  // and has no other way to learn this project's sessions.
  if (ctx.sessionsListedFresh(2000)) {
    post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
    return
  }
  const views = await collectProjectSessions(ctx, sessions)
  if (gone()) return
  ctx.setSessions(views)
  post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...views] })
}

/**
 * Fast reactivation of an already-initialized context: re-register routes and
 * push in-memory state without re-running the full initialization sequence
 * (state load, worktree discovery, session listing, prompt recovery). Returns
 * false when the context is not ready and the caller must run the full init.
 */
export function reactivateProject(
  ctx: ProjectContext,
  sessions: Parameters<typeof registerProjectSessions>[1],
  pushState: (ctx: ProjectContext) => void,
): boolean {
  if (ctx.lifecycle !== "ready" || !ctx.peekState()) return false
  registerProjectSessions(ctx, sessions)
  pushState(ctx)
  return true
}
