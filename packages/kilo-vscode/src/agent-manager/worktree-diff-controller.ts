import { SourceController } from "../diff/SourceController"
import { resolveLocalDiffTarget } from "../diff/shared/target"
import { WorktreeDiffReverter, type StatusResolver } from "../diff/shared/reverter"
import type { DiffFile, PanelContext } from "../diff/types"
import type { DiffSource } from "../diff/sources/types"
import type { DiffSourceCatalog } from "../diff/sources/catalog"
import type { ApplyConflict, GitOps } from "./GitOps"
import { shouldStopDiffPolling } from "./delete-worktree"
import { remoteRef, type ManagedSession, type WorktreeStateManager } from "./WorktreeStateManager"
import { parseDiffId, scopeToSourceId } from "./diff-scope"
import { readDocument } from "../documents/document-reader"
import type { AgentManagerOutMessage, WorktreeDiffEntry } from "./types"

const LOCAL_DIFF_ID = "local" as const

type Target = { sessionId: string; directory: string; baseBranch: string }

type AgentManagerDiffFile = DiffFile & WorktreeDiffEntry

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
  projectId?: () => string | undefined
}

export class WorktreeDiffController {
  private readonly controller: SourceController
  private target: Target | undefined
  private applying: string | undefined
  /** Intended watch mode for the active context; isPolling lags the initial fetch. */
  private poll = false
  private owner: string | undefined
  /** Ephemeral per-context base override, keyed by context id. */
  private baseOverrides = new Map<string, string>()

  constructor(private readonly ctx: WorktreeDiffControllerContext) {
    this.controller = new SourceController(
      (id, ctx) => this.source(id, ctx),
      () => [],
      (msg) => this.ctx.post(msg as AgentManagerOutMessage),
      {
        loading: (source, loading) => ({
          type: "agentManager.worktreeDiffLoading",
          projectId: this.owner,
          sessionId: source.descriptor.id,
          loading,
        }),
        notice: (source, notice) => ({
          type: "agentManager.worktreeDiffNotice",
          projectId: this.owner,
          sessionId: source.descriptor.id,
          notice,
        }),
        diffs: (source, diffs) => ({
          type: "agentManager.worktreeDiff",
          projectId: this.owner,
          sessionId: source.descriptor.id,
          diffs: diffs as AgentManagerDiffFile[],
        }),
        diffFile: (source, file, diff) => ({
          type: "agentManager.worktreeDiffFile",
          projectId: this.owner,
          sessionId: source?.descriptor.id ?? "",
          file,
          diff: diff as AgentManagerDiffFile | null,
        }),
        revertFileResult: (source, file, result) => ({
          type: "agentManager.revertWorktreeFileResult",
          projectId: this.owner,
          sessionId: source?.descriptor.id ?? "",
          file,
          status: result.ok ? "success" : "error",
          message: result.message,
        }),
        unsupportedRevert: (source, file) => ({
          type: "agentManager.revertWorktreeFileResult",
          projectId: this.owner,
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
    return shouldStopDiffPolling(path, sessions, this.target, ctxId)
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
    if (this.controller.currentId !== id || this.owner !== this.ctx.projectId?.()) {
      await this.activate(id, false, true)
      return
    }
    this.target = undefined
    await this.controller.refresh()
  }

  public async requestFile(id: string, file: string): Promise<void> {
    if (!file) return
    if (this.controller.currentId !== id) {
      this.ctx.post({
        type: "agentManager.worktreeDiffFile",
        projectId: this.owner,
        sessionId: id,
        file,
        diff: null,
      })
      return
    }
    await this.controller.requestFile(file)
  }

  public async requestFiles(project: string | undefined, id: string, files: readonly string[]): Promise<void> {
    if (this.controller.currentId !== id || this.owner !== project || this.ctx.projectId?.() !== project) {
      for (const file of files) {
        this.ctx.post({ type: "agentManager.worktreeDiffFile", projectId: project, sessionId: id, file, diff: null })
      }
      return
    }
    await this.controller.requestFiles(files)
  }

  /** Resolve the base-branch choices for a context and push them to the webview. */
  public async postBranches(id: string): Promise<void> {
    const result = await this.branches(id).catch((err) => {
      this.ctx.log("Failed to list diff branches:", err instanceof Error ? err.message : String(err))
      return undefined
    })
    if (!result) return
    this.ctx.post({
      type: "agentManager.diffBranches",
      sessionId: id,
      branches: result.branches,
      defaultBranch: result.defaultBranch,
      autoBase: result.autoBase,
      currentBase: result.currentBase,
      isAuto: result.isAuto,
      currentBranch: result.currentBranch,
    })
  }

  /**
   * Read one file from a worktree for the document inspector. Reuses this
   * controller's state/root context because a document read is a worktree file
   * read, resolved against the same directory the diff for that context uses.
   */
  public document(sessionId: string, file: string, contextKey?: string): null {
    void this.ready("stateReady rejected, continuing document resolve:").then(() => {
      const state = this.ctx.getState()
      const worktree = sessionId === LOCAL_DIFF_ID ? undefined : state?.getWorktree(sessionId)
      const session = worktree || sessionId === LOCAL_DIFF_ID ? undefined : state?.getSession(sessionId)
      const root =
        sessionId === LOCAL_DIFF_ID
          ? this.ctx.getRoot()
          : (worktree?.path ??
            (session?.worktreeId
              ? state?.getWorktree(session.worktreeId)?.path
              : session
                ? this.ctx.getRoot()
                : undefined))
      const result = root ? readDocument(root, file) : { error: "The document context is no longer available." }
      this.ctx.post({ type: "agentManager.document", sessionId, file, requestedFile: file, contextKey, ...result })
    })
    return null
  }

  public start(id: string): void {
    if (this.controller.isPolling && this.controller.currentId === id && this.owner === this.ctx.projectId?.()) return
    this.ctx.log(`Starting diff polling for ${id}`)
    void this.activate(id, true, true)
  }

  public stop(): void {
    this.controller.stop()
    this.target = undefined
    this.poll = false
    this.owner = undefined
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

  /** Branch picker data for a context's directory, using any active override. */
  public async branches(id: string) {
    await this.ready("stateReady rejected, continuing diff branches resolve:")
    const { ctx } = parseDiffId(id)
    const target = await this.resolve(ctx)
    if (!target) return undefined
    return await this.ctx.catalog.listWorkspaceBranches(this.baseOverrides.get(ctx), target.directory)
  }

  private async activate(id: string, poll: boolean, fetch: boolean): Promise<void> {
    this.target = undefined
    this.poll = poll
    const owner = this.ctx.projectId?.()
    this.owner = owner
    await this.ready("stateReady rejected, continuing diff activate:")
    if (this.owner !== owner || this.ctx.projectId?.() !== owner) return
    const { ctx } = parseDiffId(id)
    const resolved = await this.resolve(ctx)
    if (this.owner !== owner || this.ctx.projectId?.() !== owner) return
    this.target = resolved ? { sessionId: id, ...resolved } : undefined
    // Clear any stale source notice up front; sources only push a notice when
    // one is active, so a swap away from a noticing source must reset it.
    this.ctx.post({
      type: "agentManager.worktreeDiffNotice",
      projectId: this.owner,
      sessionId: id,
      notice: undefined,
    })
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
    await this.controller.activate(id, { poll, fetch })
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
      projectId: this.owner,
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
      projectId: this.owner,
      worktreeId,
      status,
      message,
      conflicts,
    })
  }
}

function selectedDiffFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [
    ...new Set(value.filter((file): file is string => typeof file === "string").map((file) => file.trim())),
  ].filter((file) => file.length > 0)
}
