import type { KiloClient } from "@kilocode/sdk/v2/client"
import { hashFileDiffs, resolveLocalDiffTarget } from "../review-utils"
import { WorktreeDiffClient } from "../worktree-diff-client"
import type { ApplyConflict, GitOps } from "./GitOps"
import { shouldStopDiffPolling } from "./delete-worktree"
import { remoteRef, type ManagedSession, type WorktreeStateManager } from "./WorktreeStateManager"
import type { AgentManagerOutMessage, WorktreeDiffEntry } from "./types"

const LOCAL_DIFF_ID = "local" as const

type Target = { sessionId: string; directory: string; baseBranch: string }

export interface WorktreeDiffControllerContext {
  getState: () => WorktreeStateManager | undefined
  getRoot: () => string | undefined
  getStateReady: () => Promise<void> | undefined
  /**
   * SDK client — used by `revert()` via `WorktreeDiffClient` for the one-shot
   * file-status lookup. Hot polling paths (`request`, `requestFile`, `poll`)
   * deliberately bypass the client and go through `localDiff`/`localDiffFile`
   * to keep git spawns out of the Bun `kilo serve` process (see oven-sh/bun#18265).
   */
  getClient: () => KiloClient
  git: GitOps
  /** In-process diff summary (replaces client.worktree.diffSummary). */
  localDiff: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>
  /** In-process single-file diff (replaces client.worktree.diffFile). */
  localDiffFile: (dir: string, base: string, file: string) => Promise<WorktreeDiffEntry | null>
  post: (msg: AgentManagerOutMessage) => void
  log: (...args: unknown[]) => void
}

export class WorktreeDiffController {
  private interval: ReturnType<typeof setInterval> | undefined
  private session: string | undefined
  private hash: string | undefined
  private target: Target | undefined
  private applying: string | undefined

  constructor(private readonly ctx: WorktreeDiffControllerContext) {}

  public shouldStopForWorktree(path: string, sessions: ManagedSession[]): boolean {
    return shouldStopDiffPolling(path, sessions, this.target, this.session)
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
    await this.ready("stateReady rejected, continuing revert resolve:")

    const target = this.target?.sessionId === sessionId ? this.target : await this.resolve(sessionId)
    if (!target) {
      this.ctx.post({
        type: "agentManager.revertWorktreeFileResult",
        sessionId,
        file,
        status: "error",
        message: "Could not resolve diff target",
      })
      return
    }

    try {
      const diff = new WorktreeDiffClient(this.ctx.getClient(), this.ctx.git, (...args) => this.ctx.log(...args))
      const result = await diff.revertFile(target, file)
      this.ctx.post({
        type: "agentManager.revertWorktreeFileResult",
        sessionId,
        file,
        status: result.ok ? "success" : "error",
        message: result.message,
      })

      if (result.ok) void this.request(sessionId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.ctx.log("Failed to revert worktree file:", msg)
      this.ctx.post({
        type: "agentManager.revertWorktreeFileResult",
        sessionId,
        file,
        status: "error",
        message: msg,
      })
    }
  }

  public async request(sessionId: string): Promise<void> {
    await this.ready("stateReady rejected, continuing diff resolve:")

    const target = await this.resolve(sessionId)
    if (!target) return

    this.target = { sessionId, ...target }
    this.ctx.post({ type: "agentManager.worktreeDiffLoading", sessionId, loading: true })

    try {
      const files = await this.ctx.localDiff(target.directory, target.baseBranch)
      this.ctx.log(`Worktree diff returned ${files.length} file(s) for session ${sessionId}`)
      this.hash = hashFileDiffs(files)
      this.session = sessionId
      this.ctx.post({ type: "agentManager.worktreeDiff", sessionId, diffs: files })
    } catch (error) {
      this.ctx.log("Failed to fetch worktree diff:", error)
    } finally {
      this.ctx.post({ type: "agentManager.worktreeDiffLoading", sessionId, loading: false })
    }
  }

  public async requestFile(sessionId: string, file: string): Promise<void> {
    if (!file) return
    await this.ready("stateReady rejected, continuing diff detail resolve:")

    const target = this.target?.sessionId === sessionId ? this.target : await this.resolve(sessionId)
    if (!target) return

    this.target = { sessionId, directory: target.directory, baseBranch: target.baseBranch }

    try {
      const data = await this.ctx.localDiffFile(target.directory, target.baseBranch, file)
      this.ctx.post({ type: "agentManager.worktreeDiffFile", sessionId, file, diff: data })
    } catch (error) {
      this.ctx.log("Failed to fetch worktree diff file:", error)
      this.ctx.post({ type: "agentManager.worktreeDiffFile", sessionId, file, diff: null })
    }
  }

  public start(sessionId: string): void {
    if (this.session === sessionId && this.interval) {
      this.ctx.log(`Already polling session ${sessionId}, skipping restart`)
      return
    }

    this.stop()
    this.session = sessionId
    this.hash = undefined
    this.ctx.log(`Starting diff polling for session ${sessionId}`)

    void this.request(sessionId).then(() => {
      if (this.session !== sessionId) return
      this.interval = setInterval(() => {
        void this.poll(sessionId)
      }, 2500)
    })
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
    this.session = undefined
    this.hash = undefined
    this.target = undefined
  }

  private async poll(sessionId: string): Promise<void> {
    const target = this.target?.sessionId === sessionId ? this.target : undefined
    if (!target) return

    try {
      const files = await this.ctx.localDiff(target.directory, target.baseBranch)
      const hash = hashFileDiffs(files)
      if (hash === this.hash && this.session === sessionId) return
      this.hash = hash
      this.session = sessionId
      this.ctx.post({ type: "agentManager.worktreeDiff", sessionId, diffs: files })
    } catch (error) {
      this.ctx.log("Failed to poll worktree diff:", error)
    }
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
