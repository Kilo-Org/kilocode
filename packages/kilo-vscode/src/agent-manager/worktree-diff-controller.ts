import { SourceController } from "../diff/SourceController"
import { resolveLocalDiffTarget } from "../diff/shared/target"
import { WorktreeDiffReverter, type StatusResolver } from "../diff/shared/reverter"
import type { DiffFile, PanelContext } from "../diff/types"
import type { DiffSource } from "../diff/sources/types"
import type { DiffSourceCatalog } from "../diff/sources/catalog"
import type { ApplyConflict, GitOps } from "./GitOps"
import { shouldStopDiffPolling } from "./delete-worktree"
import { remoteRef, type ManagedSession, type WorktreeStateManager } from "./WorktreeStateManager"
import { composeDiffId, parseDiffId, scopeToSourceId } from "./diff-scope"
import { diffSummary } from "./local-diff"
import type { AgentManagerOutMessage, WorktreeDiffEntry } from "./types"

const LOCAL_DIFF_ID = "local" as const
const CACHE_MAX_ENTRIES = 4
const CACHE_MAX_BYTES = 40_000_000
const CACHE_TTL = 10_000

type Target = { sessionId: string; directory: string; baseBranch: string }

type AgentManagerDiffFile = DiffFile & WorktreeDiffEntry
type CacheEntry = { diffs: AgentManagerDiffFile[]; time: number; bytes: number }

export interface WorktreeDiffControllerContext {
  getState: () => WorktreeStateManager | undefined
  getRoot: () => string | undefined
  getStateReady: () => Promise<void> | undefined
  /** Builds the underlying per-scope diff sources (workspace/staged/unstaged/session). */
  catalog: DiffSourceCatalog
  /** Shared git ops, injected into sources so they don't spawn their own channels. */
  git: GitOps
  /** In-process single-file diff (replaces client.worktree.diffFile). Used by revert. */
  localDiffFile: (dir: string, base: string, file: string) => Promise<WorktreeDiffEntry | null>
  post: (msg: AgentManagerOutMessage) => void
  log: (...args: unknown[]) => void
}

export class WorktreeDiffController {
  private readonly controller: SourceController
  private target: Target | undefined
  private applying: string | undefined
  /** Intended watch mode for the active context; isPolling lags the initial fetch. */
  private poll = false
  /** Ephemeral per-context base override, keyed by context id. */
  private baseOverrides = new Map<string, string>()
  private diffCache = new Map<string, CacheEntry>()
  private revisions = new Map<string, number>()
  private preloading = new Set<string>()

  constructor(private readonly ctx: WorktreeDiffControllerContext) {
    this.controller = new SourceController(
      (id, ctx) => this.source(id, ctx),
      () => [],
      (msg) => this.ctx.post(msg as AgentManagerOutMessage),
      {
        loading: (source, loading) => ({
          type: "agentManager.worktreeDiffLoading",
          sessionId: source.descriptor.id,
          loading,
        }),
        notice: (source, notice) => ({
          type: "agentManager.worktreeDiffNotice",
          sessionId: source.descriptor.id,
          notice,
        }),
        diffs: (source, diffs) => {
          this.remember(source.descriptor.id, diffs as AgentManagerDiffFile[])
          return {
            type: "agentManager.worktreeDiff",
            sessionId: source.descriptor.id,
            diffs: diffs as AgentManagerDiffFile[],
          }
        },
        diffFile: (source, file, diff) => ({
          type: "agentManager.worktreeDiffFile",
          sessionId: source?.descriptor.id ?? "",
          file,
          diff: diff as AgentManagerDiffFile | null,
        }),
        revertFileResult: (source, file, result) => ({
          type: "agentManager.revertWorktreeFileResult",
          sessionId: source?.descriptor.id ?? "",
          file,
          status: result.ok ? "success" : "error",
          message: result.message,
        }),
        unsupportedRevert: (source, file) => ({
          type: "agentManager.revertWorktreeFileResult",
          sessionId: source?.descriptor.id ?? "",
          file,
          status: "error",
          message: "Revert is not supported for the current source",
        }),
      },
    )
    this.controller.setContext({ workspaceRoot: this.ctx.getRoot() })
  }

  public shouldStopForWorktree(path: string, sessions: ManagedSession[]): boolean {
    // The parsed context id is a worktree id (or `local`), so the
    // orphaned-session check matches sessions of the deleted worktree.
    const current = this.controller.currentId
    const ctxId = current ? parseDiffId(current).ctx : undefined
    const stop = shouldStopDiffPolling(path, sessions, this.target, ctxId)
    if (stop && ctxId) this.invalidate(ctxId)
    return stop
  }

  public async apply(worktreeId: string, value?: unknown): Promise<void> {
    if (this.applying) {
      this.postApplyResult(worktreeId, "error", "Another apply operation is already in progress")
      return
    }

    const files = selectedDiffFiles(value)
    if (files && files.length === 0) {
      this.postApplyResult(worktreeId, "error", "Select at least one file to apply")
      return
    }

    const state = this.ctx.getState()
    const root = this.ctx.getRoot()
    if (!state || !root) {
      this.postApplyResult(worktreeId, "error", "Open a git repository to apply changes")
      return
    }

    const worktree = state.getWorktree(worktreeId)
    if (!worktree) {
      this.postApplyResult(worktreeId, "error", "Worktree not found")
      return
    }

    this.applying = worktreeId

    try {
      this.postApplyResult(worktreeId, "checking", "Checking for conflicts...")
      const patch = await this.ctx.git.buildWorktreePatch(worktree.path, remoteRef(worktree), files)

      if (!patch.trim()) {
        this.postApplyResult(worktreeId, "success", "No changes to apply")
        return
      }

      const check = await this.ctx.git.checkApplyPatch(root, patch)
      if (!check.ok) {
        this.postApplyResult(worktreeId, "conflict", check.message, check.conflicts)
        return
      }

      this.postApplyResult(worktreeId, "applying", "Applying changes to local branch...")
      const applied = await this.ctx.git.applyPatch(root, patch)
      if (!applied.ok) {
        const conflict = applied.conflicts.length > 0
        const status = conflict ? "conflict" : "error"
        this.postApplyResult(worktreeId, status, applied.message, applied.conflicts)
        return
      }

      this.postApplyResult(worktreeId, "success", "Applied worktree changes to local branch")
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.ctx.log("Failed to apply worktree diff:", msg)
      this.postApplyResult(worktreeId, "error", msg)
    } finally {
      this.applying = undefined
    }
  }

  public async revert(id: string, file: string): Promise<void> {
    if (!file) return
    if (this.controller.currentId !== id) {
      const result = await this.revertFile(id, file)
      this.postRevertResult(id, file, result)
      return
    }
    await this.controller.revertFile(file)
  }

  public async request(id: string): Promise<void> {
    if (this.controller.currentId !== id) {
      await this.activate(id, false, true)
      return
    }
    this.target = undefined
    await this.controller.refresh()
  }

  public async requestFile(id: string, file: string): Promise<void> {
    if (!file) return
    if (this.controller.currentId !== id) {
      this.ctx.post({ type: "agentManager.worktreeDiffFile", sessionId: id, file, diff: null })
      return
    }
    await this.controller.requestFile(file)
  }

  public start(id: string): void {
    if (this.controller.isPolling && this.controller.currentId === id) return
    this.ctx.log(`Starting diff polling for ${id}`)
    void this.activate(id, true, true)
  }

  public stop(): void {
    this.controller.stop()
    this.target = undefined
    this.poll = false
  }

  /**
   * Set or clear an ephemeral base override for a context (worktree or local),
   * then re-activate the current source so it refetches against the new base.
   * Passing undefined clears the override and falls back to the recorded parent.
   */
  public async setBase(id: string, branch: string | undefined): Promise<void> {
    const { ctx } = parseDiffId(id)
    if (branch) this.baseOverrides.set(ctx, branch)
    else this.baseOverrides.delete(ctx)
    this.revisions.set(ctx, (this.revisions.get(ctx) ?? 0) + 1)
    this.invalidate(ctx)
    // Nothing to rebuild when the context isn't active; the override is
    // picked up the next time start()/request() resolves it.
    if (this.controller.currentId !== id) return
    // Route through activate() so the base is re-resolved and pushed via
    // setContext() — SourceController.reactivate() alone would rebuild the
    // source against the stale context captured by the last activate(). The
    // recorded poll intent preserves watch mode even when the initial fetch
    // is still in flight (isPolling only turns true once it resolves).
    await this.activate(id, this.poll, true)
  }

  /** Preload diffs for adjacent or visible worktrees in the background. */
  public async preload(ids: string[]): Promise<void> {
    await this.ready("stateReady rejected, continuing diff preload:")
    for (const id of ids) {
      if (!id || this.diffCache.size >= CACHE_MAX_ENTRIES) break
      const parsed = parseDiffId(id)
      const ctx = parsed.ctx
      const key = composeDiffId(ctx, parsed.scope, parsed.sessionId)
      if (this.controller.currentId === key || this.preloading.has(key)) continue
      const cached = this.diffCache.get(key)
      if (cached && Date.now() - cached.time < CACHE_TTL) continue

      const resolved = await this.resolve(ctx)
      if (!resolved) continue

      const revision = this.revisions.get(ctx) ?? 0
      this.preloading.add(key)
      try {
        const entries = await diffSummary(this.ctx.git, resolved.directory, resolved.baseBranch, (...args) =>
          this.ctx.log(...args),
        )
        const diffs = entries.map(toDiffFile) as AgentManagerDiffFile[]
        if ((this.revisions.get(ctx) ?? 0) !== revision) continue
        this.remember(key, diffs)
        this.ctx.post({
          type: "agentManager.worktreeDiff",
          sessionId: key,
          diffs,
        })
      } catch (err) {
        this.ctx.log("Preload diff failed for", id, err)
      } finally {
        this.preloading.delete(key)
      }
    }
  }

  /** Branch picker data for a context's directory, using any active override. */
  public async branches(id: string) {
    await this.ready("stateReady rejected, continuing diff branches resolve:")
    const { ctx } = parseDiffId(id)
    const target = await this.resolve(ctx)
    if (!target) return undefined
    return await this.ctx.catalog.listWorkspaceBranches(this.baseOverrides.get(ctx), target.directory)
  }

  public async sendBranches(id: string): Promise<void> {
    const result = await this.branches(id).catch((err) => {
      this.ctx.log("Failed to list diff branches:", err instanceof Error ? err.message : String(err))
      return undefined
    })
    if (!result) return
    this.ctx.post({ type: "agentManager.diffBranches", sessionId: id, ...result })
  }

  private async activate(id: string, poll: boolean, fetch: boolean): Promise<void> {
    this.target = undefined
    this.poll = poll
    await this.ready("stateReady rejected, continuing diff activate:")
    const { ctx } = parseDiffId(id)
    const resolved = await this.resolve(ctx)
    this.target = resolved ? { sessionId: id, ...resolved } : undefined
    // Clear any stale source notice up front; sources only push a notice when
    // one is active, so a swap away from a noticing source must reset it.
    this.ctx.post({ type: "agentManager.worktreeDiffNotice", sessionId: id, notice: undefined })

    // If we have cached diffs for this context, push them immediately to eliminate initial loading delay!
    const cached = this.diffCache.get(id)
    const warm = cached && Date.now() - cached.time < CACHE_TTL ? cached : undefined
    if (warm) {
      this.diffCache.delete(id)
      this.diffCache.set(id, warm)
      this.ctx.post({
        type: "agentManager.worktreeDiff",
        sessionId: id,
        diffs: warm.diffs,
      })
      this.ctx.post({ type: "agentManager.worktreeDiffLoading", sessionId: id, loading: false })
    } else if (cached) {
      this.diffCache.delete(id)
    }

    this.controller.setContext({
      workspaceRoot: this.ctx.getRoot(),
      dir: resolved?.directory,
      // The resolved base already bakes in any ephemeral override (see
      // resolve()), so pass it as the explicit base and leave
      // baseBranchOverride unset to avoid double resolution.
      baseBranch: resolved?.baseBranch,
      // Agent Manager always knows its intended directory (LOCAL resolves to
      // the root). Never fall back to the workspace root for an unresolvable
      // worktree context — return an empty diff instead.
      strictDir: true,
      git: this.ctx.git,
      log: (...args) => this.ctx.log(...args),
    })
    await this.controller.activate(id, { poll, fetch, known: warm?.diffs })
  }

  private async resolve(ctxId: string): Promise<{ directory: string; baseBranch: string } | undefined> {
    if (ctxId === LOCAL_DIFF_ID) return await this.resolveLocal()
    const state = this.ctx.getState()
    if (!state) {
      this.ctx.log(`resolveDiffTarget: no state manager for context ${ctxId}`)
      return undefined
    }

    // The context is the worktree itself (the sidebar selection), not one of
    // its sessions — resolution survives session churn inside the worktree.
    const worktree = state.getWorktree(ctxId)
    if (!worktree) {
      this.ctx.log(`resolveDiffTarget: worktree ${ctxId} not found`)
      return undefined
    }
    const base = this.baseOverrides.get(ctxId) ?? remoteRef(worktree)
    return { directory: worktree.path, baseBranch: base }
  }

  private async resolveLocal(): Promise<{ directory: string; baseBranch: string } | undefined> {
    const root = this.ctx.getRoot()
    if (!root) return undefined
    const override = this.baseOverrides.get(LOCAL_DIFF_ID)
    if (override) {
      return { directory: root, baseBranch: override }
    }
    return await resolveLocalDiffTarget(this.ctx.git, (...args) => this.ctx.log(...args), root)
  }

  private async ready(msg: string): Promise<void> {
    await this.ctx.getStateReady()?.catch((err) => this.ctx.log(msg, err))
  }

  private remember(id: string, diffs: AgentManagerDiffFile[]): void {
    const bytes = diffs.reduce(
      (sum, diff) => sum + (diff.patch?.length ?? 0) + diff.before.length + diff.after.length,
      0,
    )
    this.diffCache.delete(id)
    if (bytes > CACHE_MAX_BYTES) return
    this.diffCache.set(id, { diffs, time: Date.now(), bytes })
    const total = () => [...this.diffCache.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    while (this.diffCache.size > CACHE_MAX_ENTRIES || total() > CACHE_MAX_BYTES) {
      this.diffCache.delete(this.diffCache.keys().next().value!)
    }
  }

  private invalidate(ctx: string): void {
    for (const id of this.diffCache.keys()) {
      if (parseDiffId(id).ctx === ctx) this.diffCache.delete(id)
    }
  }

  /**
   * Build the active source for a composite id by delegating to the catalog.
   * The composite id (`ctx#scope`, or `ctx#session:<sid>` for the session
   * scope) is preserved as the descriptor id so the webview keys diff data by
   * context+scope. Context resolution (dir/base) already happened in
   * activate() and is carried by the PanelContext.
   */
  private source(id: string, panelCtx: PanelContext): DiffSource {
    const { ctx, scope, sessionId } = parseDiffId(id)
    const built = this.ctx.catalog.build(scopeToSourceId(scope, ctx, sessionId), panelCtx)
    return {
      ...built,
      descriptor: { ...built.descriptor, id },
    }
  }

  private async revertFile(id: string, file: string): Promise<{ ok: boolean; message: string }> {
    await this.ready("stateReady rejected, continuing revert resolve:")
    const { ctx } = parseDiffId(id)
    const target = await this.resolve(ctx)
    if (!target) return { ok: false, message: "Could not resolve diff target" }

    try {
      const status: StatusResolver = async (current, item) => {
        const diff = await this.ctx.localDiffFile(current.directory, current.baseBranch, item)
        return diff?.status
      }
      const diff = new WorktreeDiffReverter(this.ctx.git, status, (...args) => this.ctx.log(...args))
      return await diff.revertFile(target, file)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.ctx.log("Failed to revert worktree file:", msg)
      return { ok: false, message: msg }
    }
  }

  private postRevertResult(sessionId: string, file: string, result: { ok: boolean; message: string }): void {
    this.ctx.post({
      type: "agentManager.revertWorktreeFileResult",
      sessionId,
      file,
      status: result.ok ? "success" : "error",
      message: result.message,
    })
  }

  private postApplyResult(
    worktreeId: string,
    status: "checking" | "applying" | "success" | "conflict" | "error",
    message: string,
    conflicts?: ApplyConflict[],
  ): void {
    this.ctx.post({
      type: "agentManager.applyWorktreeDiffResult",
      worktreeId,
      status,
      message,
      conflicts,
    })
  }
}

function toDiffFile(entry: WorktreeDiffEntry): AgentManagerDiffFile {
  return {
    file: entry.file ?? "",
    before: entry.before ?? "",
    after: entry.after ?? "",
    patch: entry.patch,
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: entry.generatedLike,
    summarized: entry.summarized,
    stamp: entry.stamp,
    kind: entry.kind,
    image: entry.image,
  }
}

function selectedDiffFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [
    ...new Set(value.filter((file): file is string => typeof file === "string").map((file) => file.trim())),
  ].filter((file) => file.length > 0)
}
