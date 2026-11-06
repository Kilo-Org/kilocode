/**
 * Repository-local state initialization for one Agent Manager project context.
 *
 * Extracted from AgentManagerProvider so the same sequence runs for the
 * active project (full panel wiring follows) and for expanded background
 * projects (state push only). Ordering matters: the git exclude update must
 * land before the persisted state file is read.
 */

import * as fs from "fs"
import type { SessionInfo } from "@opencode/client"
import type { AgentManagerOutMessage } from "../types"
import { restoreWorktrees } from "../state-recovery"
import { reconcileWorktrees, summarize, type WorktreeHealthReport } from "../worktree-reconcile"
import { trackOrphanSizes } from "../orphans/sizing"
import { samePath } from "./paths"
import type { ProjectSessionView } from "./session-view"
import type { ProjectContext, ProjectInitResult } from "./context"

export async function initContextState(
  ctx: ProjectContext,
  log: (...args: unknown[]) => void,
  opts?: { warm?: boolean },
): Promise<ProjectInitResult> {
  // Cached hydration is read-only with respect to the pool. User activation can request warming explicitly.
  const warm = opts?.warm === true || (opts?.warm !== false && ctx.lifecycle === "cold")
  const generation = ctx.generation
  const result = await ctx.ensureReady(async (generation) => {
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

    // Disk to state recovery above only ever adds rows. This pass is the other direction: classify
    // what is already tracked, prune what git can drop, and clear rows that cannot lose anything.
    const health = await reconcileProject(ctx, log)
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    if (health && health.dropped.length > 0) await state.flush()
    return { ok: true, refsFixed: loaded.refsFixed, health }
  })
  if (warm && result.ok && result.current && ctx.isCurrent(generation)) ctx.warmPool()
  return result
}

/**
 * Reconcile state rows, git registrations, and directories for one project, storing the verdict on
 * the context so pollers can skip worktrees that cannot answer.
 *
 * Failure here is never fatal: a project whose health is unknown keeps working, it just does not
 * get self-healing until the next pass.
 */
export async function reconcileProject(
  ctx: ProjectContext,
  log: (...args: unknown[]) => void,
): Promise<WorktreeHealthReport | undefined> {
  const manager = ctx.worktreeManager()
  const state = ctx.stateManager()
  const report = await reconcileWorktrees({
    root: ctx.root,
    dir: manager.worktreesDir,
    rows: () => state.getWorktrees().map((wt) => ({ id: wt.id, path: wt.path, branch: wt.branch })),
    sessions: (id) => state.getSessions(id).length,
    registered: () => manager.registeredPaths(),
    dirs: () => manager.worktreeDirs(),
    exists: (target) =>
      fs.promises.access(target).then(
        () => true,
        () => false,
      ),
    branchExists: (branch) => manager.branchExists(branch),
    prune: () => manager.pruneWorktrees(),
    drop: (id) => state.removeWorktree(id),
    log: (msg) => log(msg),
  }).catch((err: unknown) => {
    log("Failed to reconcile worktree health:", err)
    return undefined
  })
  if (!report) return undefined
  ctx.report = report
  log(`worktree health: ${summarize(report)}`)
  trackOrphanSizes(ctx, report.orphans, log)
  return report
}

/**
 * Fast reactivation of an already-initialized context: push in-memory state without re-running the
 * full initialization sequence. Returns false when the context is not ready and the caller must run
 * the full init.
 */
export function reactivateProject(ctx: ProjectContext, pushState: (ctx: ProjectContext) => void): boolean {
  if (ctx.lifecycle !== "ready" || !ctx.peekState()) return false
  pushState(ctx)
  return true
}

/**
 * Backend and delivery hooks for the sidebar session catalog.
 *
 * Session events reach {@link handleSessionLifecycle} without a host reference, so the provider
 * registers its single catalog host against its busy-session set. Events arrive only for a live
 * connection, and the set is the same instance the provider passes to the lifecycle handler.
 */
export interface SessionCatalogHost {
  /** Project context that owns a directory: its root or one of its worktree paths. */
  contextForDirectory(directory: string): ProjectContext | undefined
  /** Project context whose live session list contains the id. */
  contextForSession(sessionID: string): ProjectContext | undefined
  /** Root sessions listed from one directory by the backend. */
  list(directory: string): Promise<SessionInfo[]>
  /** One backend session, for create events that carry no full record. */
  get(sessionID: string): Promise<SessionInfo | undefined>
  /** Post one message to the webview. */
  post(message: AgentManagerOutMessage): void
  /** Report one catalog failure to the output channel. */
  log(...args: unknown[]): void
}

const catalogs = new WeakMap<Set<string>, SessionCatalogHost>()

export function registerSessionCatalogHost(busy: Set<string>, host: SessionCatalogHost | undefined): void {
  if (host) catalogs.set(busy, host)
  else catalogs.delete(busy)
}

export function sessionCatalogHost(busy: Set<string>): SessionCatalogHost | undefined {
  return catalogs.get(busy)
}

/**
 * Directories whose root sessions belong to this project: exactly the project root plus the path of
 * every tracked worktree. No workspace root is mixed in, so sessions from unrelated projects cannot
 * leak into the catalog.
 */
export function projectDirectories(ctx: ProjectContext): { directory: string; worktreeId: string | null }[] {
  const entries: { directory: string; worktreeId: string | null }[] = [{ directory: ctx.root, worktreeId: null }]
  for (const worktree of ctx.peekState()?.getWorktrees() ?? []) {
    if (worktree.path) entries.push({ directory: worktree.path, worktreeId: worktree.id })
  }
  return entries.filter(
    (entry, index) => entries.findIndex((item) => samePath(item.directory, entry.directory)) === index,
  )
}

/**
 * Collect live root sessions for this project by listing the project root and every worktree
 * directory. A failed listing resolves to [] for that directory and never erases the others.
 */
export async function collectProjectSessions(
  ctx: ProjectContext,
  list: ((directory: string) => Promise<SessionInfo[]>) | undefined,
  log: (...args: unknown[]) => void,
): Promise<ProjectSessionView[]> {
  if (!list) return []
  const generation = ctx.generation
  const byDirectory = await Promise.all(
    projectDirectories(ctx).map(async (entry) => ({
      ...entry,
      sessions: await list(entry.directory).catch((err: unknown) => {
        log(`Agent Manager: listing sessions for ${entry.directory} failed:`, err)
        return [] as SessionInfo[]
      }),
    })),
  )
  if (!ctx.isCurrent(generation)) return []
  const seen = new Set<string>()
  const views: ProjectSessionView[] = []
  for (const entry of byDirectory) {
    for (const session of entry.sessions) {
      if (session.parentID !== undefined && session.parentID !== null) continue
      if (seen.has(session.id)) continue
      seen.add(session.id)
      const managed = ctx.peekState()?.getSession(session.id)?.worktreeId
      views.push({
        ...session,
        parentID: undefined,
        worktreeId: managed ?? entry.worktreeId,
      })
    }
  }
  return views
}

/** How long a collected catalog is reused before the next push re-lists from the backend. */
const FRESH_MS = 2000

/**
 * Post this project's session catalog. A fresh catalog is re-posted from memory, so a webview that
 * mounted after the last push still learns the sessions; otherwise the backend is listed again.
 */
export async function pushProjectSessions(
  ctx: ProjectContext,
  list: ((directory: string) => Promise<SessionInfo[]>) | undefined,
  post: (message: AgentManagerOutMessage) => void,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const gone = () => ctx.lifecycle === "disposed" || ctx.lifecycle === "disposing"
  if (!list || gone()) return
  if (ctx.sessionsListedFresh(FRESH_MS)) {
    post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
    return
  }
  const generation = ctx.generation
  const views = await collectProjectSessions(ctx, list, log)
  if (gone()) return
  if (!ctx.isCurrent(generation)) return
  ctx.setSessions(views)
  post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...views] })
}
