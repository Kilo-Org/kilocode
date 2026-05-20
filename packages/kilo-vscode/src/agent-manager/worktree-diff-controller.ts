import { SourceController } from "../diff/SourceController"
import { resolveLocalDiffTarget } from "../diff/shared/target"
import { WorktreeDiffReverter, type StatusResolver } from "../diff/shared/reverter"
import type { DiffFile } from "../diff/types"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "../diff/sources/types"
import type { ApplyConflict, GitOps } from "./GitOps"
import { shouldStopDiffPolling } from "./delete-worktree"
import { remoteRef, type ManagedSession, type WorktreeStateManager } from "./WorktreeStateManager"
import type { AgentManagerOutMessage, WorktreeDiffEntry } from "./types"

const LOCAL_DIFF_ID = "local" as const

type Target = { sessionId: string; directory: string; baseBranch: string }

type AgentManagerDiffFile = DiffFile & WorktreeDiffEntry

export interface WorktreeDiffControllerContext {
  getState: () => WorktreeStateManager | undefined
  getRoot: () => string | undefined
  getStateReady: () => Promise<void> | undefined
  /**
   * In-process diff paths deliberately bypass the SDK client to keep git spawns
   * out of the Bun `kilo serve` process (see oven-sh/bun#18265).
   */
  git: GitOps
  /** In-process diff summary (replaces client.worktree.diffSummary). */
  localDiff: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>
  /** In-process single-file diff (replaces client.worktree.diffFile). */
  localDiffFile: (dir: string, base: string, file: string) => Promise<WorktreeDiffEntry | null>
  post: (msg: AgentManagerOutMessage) => void
  log: (...args: unknown[]) => void
}

export class WorktreeDiffController {
  private readonly controller: SourceController
  private target: Target | undefined
  private applying: string | undefined

  constructor(private readonly ctx: WorktreeDiffControllerContext) {
    this.controller = new SourceController(
      (id) => this.source(id),
      () => [],
      (msg) => this.ctx.post(msg as AgentManagerOutMessage),
      {
        loading: (source, loading) => ({
          type: "agentManager.worktreeDiffLoading",
          sessionId: source.descriptor.id,
          loading,
        }),
        diffs: (source, diffs) => ({
          type: "agentManager.worktreeDiff",
          sessionId: source.descriptor.id,
          diffs: diffs as AgentManagerDiffFile[],
        }),
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
    return shouldStopDiffPolling(path, sessions, this.target, this.controller.currentId)
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

  public async revert(sessionId: string, file: string): Promise<void> {
    if (!file) return
    if (this.controller.currentId !== sessionId) {
      const result = await this.revertFile(sessionId, file)
      this.postRevertResult(sessionId, file, result)
      return
    }
    await this.controller.revertFile(file)
  }

  public async request(sessionId: string): Promise<void> {
    if (this.controller.currentId !== sessionId) {
      await this.activate(sessionId, false, true)
      return
    }
    this.target = undefined
    await this.controller.refresh()
  }

  public async requestFile(sessionId: string, file: string): Promise<void> {
    if (!file) return
    if (this.controller.currentId !== sessionId) {
      this.ctx.post({ type: "agentManager.worktreeDiffFile", sessionId, file, diff: null })
      return
    }
    await this.controller.requestFile(file)
  }

  public start(sessionId: string): void {
    if (this.controller.isPolling && this.controller.currentId === sessionId) return
    this.ctx.log(`Starting diff polling for session ${sessionId}`)
    void this.activate(sessionId, true, true)
  }

  public stop(): void {
    this.controller.stop()
    this.target = undefined
  }

  private async activate(sessionId: string, poll: boolean, fetch: boolean): Promise<void> {
    this.target = undefined
    this.controller.setContext({ workspaceRoot: this.ctx.getRoot() })
    await this.controller.activate(sessionId, { poll, fetch })
  }

  private async resolve(sessionId: string): Promise<{ directory: string; baseBranch: string } | undefined> {
    if (sessionId === LOCAL_DIFF_ID) return await this.resolveLocal()
    const state = this.ctx.getState()
    if (!state) {
      this.ctx.log(`resolveDiffTarget: no state manager for session ${sessionId}`)
      return undefined
    }

    const session = state.getSession(sessionId)
    if (!session) {
      this.ctx.log(
        `resolveDiffTarget: session ${sessionId} not found in state (${state.getSessions().length} total sessions)`,
      )
      return undefined
    }
    if (!session.worktreeId) {
      this.ctx.log(`resolveDiffTarget: session ${sessionId} has no worktreeId (local session)`)
      return undefined
    }

    const worktree = state.getWorktree(session.worktreeId)
    if (!worktree) {
      this.ctx.log(`resolveDiffTarget: worktree ${session.worktreeId} not found for session ${sessionId}`)
      return undefined
    }
    return { directory: worktree.path, baseBranch: remoteRef(worktree) }
  }

  private async resolveLocal(): Promise<{ directory: string; baseBranch: string } | undefined> {
    return await resolveLocalDiffTarget(this.ctx.git, (...args) => this.ctx.log(...args), this.ctx.getRoot())
  }

  private async ready(msg: string): Promise<void> {
    await this.ctx.getStateReady()?.catch((err) => this.ctx.log(msg, err))
  }

  private source(sessionId: string): DiffSource {
    const descriptor: DiffSourceDescriptor = {
      id: sessionId,
      type: "workspace",
      group: "Git",
      capabilities: { revert: true, comments: true },
    }

    return {
      descriptor,
      fetch: () => this.fetch(sessionId),
      fetchFile: (file) => this.fetchFile(sessionId, file),
      revert: (file) => this.revertFile(sessionId, file),
    }
  }

  private async fetch(sessionId: string): Promise<DiffSourceFetch> {
    await this.ready("stateReady rejected, continuing diff resolve:")
    const target = await this.ensureTarget(sessionId)
    if (!target) return { diffs: [], stopPolling: true }

    const files = await this.ctx.localDiff(target.directory, target.baseBranch)
    this.ctx.log(`Worktree diff returned ${files.length} file(s) for session ${sessionId}`)
    return { diffs: files as AgentManagerDiffFile[] }
  }

  private async fetchFile(sessionId: string, file: string): Promise<DiffFile | null> {
    await this.ready("stateReady rejected, continuing diff detail resolve:")
    const target = await this.ensureTarget(sessionId)
    if (!target) return null

    try {
      return (await this.ctx.localDiffFile(target.directory, target.baseBranch, file)) as AgentManagerDiffFile | null
    } catch (error) {
      this.ctx.log("Failed to fetch worktree diff file:", error)
      return null
    }
  }

  private async revertFile(sessionId: string, file: string): Promise<{ ok: boolean; message: string }> {
    await this.ready("stateReady rejected, continuing revert resolve:")
    const target = await this.resolveTarget(sessionId)
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

  private async ensureTarget(sessionId: string): Promise<Target | undefined> {
    if (this.controller.currentId !== sessionId) return undefined
    if (this.target?.sessionId === sessionId) return this.target
    return await this.resolveTarget(sessionId)
  }

  private async resolveTarget(sessionId: string): Promise<Target | undefined> {
    const target = await this.resolve(sessionId)
    if (!target) return undefined
    this.target = { sessionId, ...target }
    return this.target
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

function selectedDiffFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [
    ...new Set(value.filter((file): file is string => typeof file === "string").map((file) => file.trim())),
  ].filter((file) => file.length > 0)
}
