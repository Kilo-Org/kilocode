/**
 * ProjectContext — immutable repository scope for Agent Manager.
 * ProjectContexts — coordinator owning all contexts for one panel.
 *
 * A context owns the repository-bound services that used to be singletons on
 * the provider: WorktreeStateManager, WorktreeManager, SetupScriptService,
 * plus stale-worktree tracking. Services are created lazily on first access
 * and never re-pointed at another root, so a context can never mix state
 * between repositories.
 *
 * Lifecycle policy:
 * - The pinned context is derived from the current VS Code workspace root and
 *   always exists while a folder is open. It is implicit and never persisted.
 * - Additional projects come from the ProjectRegistry. Their contexts are
 *   created on demand (expand/select), never eagerly at panel open.
 * - Only the active context gets full Git/PR polling; the pollers follow the
 *   active context through the provider's accessors.
 * - Non-pinned contexts require the multi-project flag and registry trust
 *   before they can be expanded or activated. Trust is checked here, before
 *   any state load that could write git metadata.
 */

import * as fs from "fs"
import * as path from "path"
import { WorktreeStateManager } from "./WorktreeStateManager"
import { WorktreeManager } from "./WorktreeManager"
import { SetupScriptService } from "./SetupScriptService"
import type { GitOps } from "./GitOps"
import { canonicalizePath, projectIdFor, samePath } from "./project-paths"
import type { ProjectSessionView } from "./project-session-view"
import type { StoredProject } from "./project-registry"

export interface ProjectContextDeps {
  log: (msg: string) => void
  git?: GitOps
  exists?: (dir: string) => boolean
  /** Factory overrides for tests. */
  state?: (root: string, log: (msg: string) => void) => WorktreeStateManager
  worktrees?: (root: string, log: (msg: string) => void, git?: GitOps) => WorktreeManager
  setup?: (root: string) => SetupScriptService
}

export type ProjectLifecycle = "cold" | "initializing" | "ready" | "suspended" | "disposing" | "disposed"

export interface ProjectInitResult {
  ok: boolean
  refsFixed: number
  current: boolean
}

export class ProjectContext {
  private state: WorktreeStateManager | undefined
  private worktrees: WorktreeManager | undefined
  private setup: SetupScriptService | undefined
  private init: Promise<ProjectInitResult> | undefined
  private last: ProjectInitResult | undefined
  private phase: ProjectLifecycle = "cold"
  private version = 0
  private mutation: Promise<unknown> = Promise.resolve()
  private live = new Set<string>()
  private listed = 0
  private views: readonly ProjectSessionView[] = []
  readonly stale = new Set<string>()

  constructor(
    readonly id: string,
    readonly root: string,
    readonly pinned: boolean,
    private readonly deps: ProjectContextDeps,
  ) {}

  get lifecycle(): ProjectLifecycle {
    return this.phase
  }

  get generation(): number {
    return this.version
  }

  isCurrent(generation: number): boolean {
    return this.version === generation && this.phase !== "disposing" && this.phase !== "disposed"
  }

  /** Initialize repository state exactly once per context lifetime. */
  ensureReady(run: (generation: number) => Promise<Omit<ProjectInitResult, "current">>): Promise<ProjectInitResult> {
    if (this.phase === "disposed" || this.phase === "disposing") {
      return Promise.resolve({ ok: false, refsFixed: 0, current: false })
    }
    if (this.phase === "ready" && this.last) return Promise.resolve(this.last)
    if (this.phase === "suspended" && this.last) {
      this.phase = "ready"
      return Promise.resolve(this.last)
    }
    if (this.init) return this.init
    const generation = this.version
    this.phase = "initializing"
    this.init = run(generation)
      .then((result) => {
        const current = this.isCurrent(generation)
        const next = { ...result, current }
        if (current) {
          this.last = next
          this.phase = result.ok ? "ready" : "cold"
        }
        return next
      })
      .finally(() => {
        this.init = undefined
      })
    return this.init
  }

  /** Invalidate asynchronous work while keeping loaded repository state reusable. */
  suspend(): void {
    if (this.phase === "disposed" || this.phase === "disposing") return
    this.version++
    this.phase = "suspended"
  }

  /** Serialize repository mutations and pin them to this context generation. */
  run<T>(operation: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.version
    const run = async () => {
      if (!this.isCurrent(generation)) throw new Error(`Project ${this.id} is no longer available.`)
      const result = await operation(generation)
      if (!this.isCurrent(generation)) throw new Error(`Project ${this.id} changed while the operation was running.`)
      return result
    }
    const next = this.mutation.then(run, run)
    this.mutation = next.catch(() => undefined)
    return next
  }

  stateManager(): WorktreeStateManager {
    this.state ??= (this.deps.state ?? ((root, log) => new WorktreeStateManager(root, log)))(this.root, (msg) =>
      this.deps.log(`[StateManager] ${msg}`),
    )
    return this.state
  }

  worktreeManager(): WorktreeManager {
    this.worktrees ??= (this.deps.worktrees ?? ((root, log, git) => new WorktreeManager(root, log, git)))(
      this.root,
      (msg) => this.deps.log(`[WorktreeManager] ${msg}`),
      this.deps.git,
    )
    return this.worktrees
  }

  setupService(): SetupScriptService {
    this.setup ??= (this.deps.setup ?? ((root) => new SetupScriptService(root)))(this.root)
    return this.setup
  }

  /** Whether repository-bound services have been created. */
  get loaded(): boolean {
    return this.state !== undefined
  }

  /** Accessors that never create services, preserving "created?" checks. */
  peekState(): WorktreeStateManager | undefined {
    return this.state
  }

  peekWorktrees(): WorktreeManager | undefined {
    return this.worktrees
  }

  peekSetup(): SetupScriptService | undefined {
    return this.setup
  }

  setLiveSessions(ids: Iterable<string>): void {
    this.live = new Set(ids)
  }

  hasLiveSession(id: string): boolean {
    return this.live.has(id)
  }

  /** Replace the cached sidebar session list and mark it freshly listed. */
  setSessions(views: readonly ProjectSessionView[]): void {
    this.views = views
    this.live = new Set(views.map((view) => view.id))
    this.listed = Date.now()
  }

  /** The last collected sidebar session list, for re-posting on fresh skips. */
  sessions(): readonly ProjectSessionView[] {
    return this.views
  }

  /** Force the next push to re-list from the backend. */
  invalidateSessions(): void {
    this.listed = 0
  }

  /** Insert or refresh one session in the cached list (creation, rename, fork). */
  upsertSession(view: ProjectSessionView): void {
    this.views = [view, ...this.views.filter((item) => item.id !== view.id)]
    this.live.add(view.id)
  }

  /** Drop one session from the cached list (deletion, close). */
  removeLiveSession(id: string): void {
    this.views = this.views.filter((item) => item.id !== id)
    this.live.delete(id)
  }

  /** Mark that the backend session list was just collected for this context. */
  markSessionsListed(): void {
    this.listed = Date.now()
  }

  /** Whether the last backend session listing is still fresh enough to reuse. */
  sessionsListedFresh(ms: number): boolean {
    return this.listed > 0 && Date.now() - this.listed < ms
  }

  missing(): boolean {
    return !(this.deps.exists ?? fs.existsSync)(this.root)
  }

  async dispose(): Promise<void> {
    if (this.phase === "disposed") return
    this.version++
    this.phase = "disposing"
    await this.init?.catch((err) => this.deps.log(`dispose: initialization failed: ${err}`))
    await this.mutation.catch((err) => this.deps.log(`dispose: mutation failed: ${err}`))
    await this.state?.flush().catch((err) => this.deps.log(`dispose: state flush failed: ${err}`))
    this.live.clear()
    this.phase = "disposed"
  }
}

/** Serializable project description for the webview. */
export interface ProjectSnapshot {
  id: string
  root: string
  label: string
  pinned: boolean
  active: boolean
  expanded: boolean
  initialized: boolean
  trusted: boolean
  missing: boolean
}

interface ContextsOptions {
  /** Current VS Code workspace root; may change when workspace folders change. */
  workspaceRoot: () => string | undefined
  registry: {
    list(): StoredProject[]
    get(id: string): StoredProject | undefined
  }
  /** Registry trust lookup for non-pinned projects. */
  trusted: (id: string) => boolean
  /** Whether the multi-project experiment is enabled. */
  enabled: () => boolean
  remove?: (id: string) => void
  deps: ProjectContextDeps
}

export class ProjectContexts {
  private readonly contexts = new Map<string, ProjectContext>()
  private activeId: string | undefined
  private readonly expanded = new Set<string>()

  constructor(private readonly opts: ContextsOptions) {}

  /** The pinned workspace project, derived lazily from the current workspace root. */
  pinned(): ProjectContext | undefined {
    const root = this.opts.workspaceRoot()
    if (!root) return undefined
    const canonical = canonicalizePath(root)
    return this.ensure(projectIdFor(canonical), canonical, true)
  }

  private ensure(id: string, root: string, pinned: boolean): ProjectContext {
    let ctx = this.contexts.get(id)
    if (!ctx) {
      ctx = new ProjectContext(id, root, pinned, this.opts.deps)
      this.contexts.set(id, ctx)
    }
    return ctx
  }

  /** Resolve any known project id to a context, creating it on demand. */
  private resolveCtx(id: string): ProjectContext | undefined {
    const existing = this.contexts.get(id)
    if (existing) return existing
    const pinned = this.pinned()
    if (pinned?.id === id) return pinned
    if (!this.opts.enabled()) return undefined
    const stored = this.opts.registry.get(id)
    if (!stored) return undefined
    return this.ensure(stored.id, stored.root, false)
  }

  /** The active context. Defaults to the pinned project, or the first trusted registry project without a workspace. */
  active(): ProjectContext | undefined {
    if (this.activeId) return this.contexts.get(this.activeId)
    const pinned = this.pinned()
    if (pinned) {
      this.activeId = pinned.id
      this.expanded.add(pinned.id)
      return pinned
    }
    if (!this.opts.enabled()) return undefined
    const first = this.opts.registry.list().find((p) => this.opts.trusted(p.id))
    if (!first) return undefined
    const ctx = this.ensure(first.id, first.root, false)
    this.activeId = ctx.id
    this.expanded.add(ctx.id)
    return ctx
  }

  get(id: string): ProjectContext | undefined {
    return this.contexts.get(id)
  }

  /** The context that owns a directory: its root or one of its worktree paths. */
  byDirectory(dir: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (samePath(ctx.root, dir)) return ctx
      const state = ctx.peekState()
      if (state?.getWorktrees().some((wt) => wt.path && samePath(wt.path, dir))) return ctx
    }
    return undefined
  }

  /** The context whose live session list contains the session. */
  byLiveSession(id: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (ctx.hasLiveSession(id)) return ctx
    }
    return undefined
  }

  /** Resolve any known project id to a context without activating it. */
  resolve(id: string): ProjectContext | undefined {
    return this.resolveCtx(id)
  }

  /** Whether a project may be shown or initialized: known, flag-gated, and trusted. */
  usable(id: string): ProjectContext | undefined {
    return this.usableCtx(id)
  }

  isActive(id: string): boolean {
    return this.active()?.id === id
  }

  isExpanded(id: string): boolean {
    return this.expanded.has(id)
  }

  /** Make a project the active context and expand it. Returns undefined when not allowed. */
  activate(id: string): ProjectContext | undefined {
    const ctx = this.usableCtx(id)
    if (!ctx) return undefined
    this.activeId = id
    return ctx
  }

  /** Expand a project without activating it. Returns undefined when not allowed. */
  expand(id: string): ProjectContext | undefined {
    const ctx = this.usableCtx(id)
    if (!ctx) return undefined
    this.expanded.add(id)
    return ctx
  }

  collapse(id: string): void {
    this.expanded.delete(id)
    if (this.isActive(id)) return
    this.contexts.get(id)?.suspend()
  }

  /** Return ownership to pinned Local and suspend all secondary contexts. */
  disable(): ProjectContext | undefined {
    const pinned = this.pinned()
    this.activeId = pinned?.id
    if (pinned) this.expanded.add(pinned.id)
    for (const ctx of this.contexts.values()) {
      if (ctx.pinned) continue
      this.expanded.delete(ctx.id)
      ctx.suspend()
      // Match remove()/syncPinned(): drop the routes too, otherwise the shared
      // route service accumulates entries for every disabled project.
      this.opts.remove?.(ctx.id)
    }
    return pinned
  }

  private usableCtx(id: string): ProjectContext | undefined {
    const ctx = this.resolveCtx(id)
    if (!ctx) return undefined
    if (ctx.pinned) return ctx
    if (!this.opts.enabled()) return undefined
    if (!this.opts.trusted(id)) return undefined
    return ctx
  }

  /** Remove a non-pinned project context. Falls back to the pinned project when it was active. */
  async remove(id: string): Promise<boolean> {
    const ctx = this.contexts.get(id)
    if (!ctx || ctx.pinned) return false
    this.expanded.delete(id)
    if (this.activeId === id) this.activeId = undefined
    this.contexts.delete(id)
    this.opts.remove?.(id)
    await ctx.dispose()
    return true
  }

  /**
   * Re-derive the pinned project after workspace folder changes. Disposes the
   * old pinned context so cached services can never mix two roots. Returns
   * true when the active context may have changed.
   */
  syncPinned(): boolean {
    const root = this.opts.workspaceRoot()
    const next = root ? projectIdFor(canonicalizePath(root)) : undefined
    const current = [...this.contexts.values()].find((ctx) => ctx.pinned)?.id
    if (current === next) return false
    for (const [id, ctx] of [...this.contexts]) {
      if (!ctx.pinned) continue
      this.contexts.delete(id)
      this.expanded.delete(id)
      if (this.activeId === id) this.activeId = undefined
      this.opts.remove?.(id)
      ctx.suspend()
      void ctx.dispose()
    }
    return true
  }

  /** Serializable snapshots for the webview: pinned first, then registry order. */
  snapshots(): ProjectSnapshot[] {
    const out: ProjectSnapshot[] = []
    const pinned = this.pinned()
    if (pinned) out.push(this.snapshot(pinned, undefined))
    if (!this.opts.enabled()) return out
    for (const stored of this.opts.registry.list()) {
      if (pinned?.id === stored.id) continue
      out.push(this.snapshot(this.contexts.get(stored.id), stored))
    }
    return out
  }

  private snapshot(ctx: ProjectContext | undefined, stored: StoredProject | undefined): ProjectSnapshot {
    const id = ctx?.id ?? stored!.id
    const root = ctx?.root ?? stored!.root
    const pinned = ctx?.pinned ?? false
    return {
      id,
      root,
      label: stored?.label || path.basename(root) || root,
      pinned,
      active: this.isActive(id),
      expanded: this.isExpanded(id),
      initialized: ctx?.loaded ?? false,
      trusted: pinned || (stored?.trusted ?? false),
      missing: ctx ? ctx.missing() : !(this.opts.deps.exists ?? fs.existsSync)(root),
    }
  }

  async dispose(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      this.opts.remove?.(ctx.id)
      await ctx.dispose()
    }
    this.contexts.clear()
    this.expanded.clear()
    this.activeId = undefined
  }
}
