/**
 * ProjectContext — immutable repository scope for Agent Manager.
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
 */

import * as fs from "fs"
import { WorktreeStateManager } from "../WorktreeStateManager"
import { WorktreeManager } from "../WorktreeManager"
import { SetupScriptService } from "../SetupScriptService"
import type { GitOps } from "../GitOps"
import type { ProjectSessionView } from "./session-view"

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
