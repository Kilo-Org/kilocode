import type { Session } from "@kilocode/sdk/v2/client"
import type { AgentManagerOutMessage } from "./types"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { classifyWorktreeError } from "./git-import"

export interface WorktreeImporterHost {
  manager(): WorktreeManager | undefined
  state(): WorktreeStateManager | undefined
  post(msg: AgentManagerOutMessage): void
  push(): void
  setup(path: string, branch?: string, worktreeId?: string): Promise<void>
  session(path: string, branch: string, worktreeId?: string): Promise<Session | null>
  register(sessionId: string, directory: string): void
  ready(sessionId: string, result: CreateWorktreeResult, worktreeId?: string): void
  log(...args: unknown[]): void
}

export class WorktreeImporter {
  private importing = false

  constructor(private readonly host: WorktreeImporterHost) {}

  async branches(projectId?: string): Promise<void> {
    const manager = this.host.manager()
    if (!manager) {
      this.host.post({ type: "agentManager.branches", projectId, branches: [], defaultBranch: "main" })
      return
    }

    try {
      const result = await manager.listBranches()
      const checked = await manager.checkedOutBranches()
      const branches = result.branches.map((branch) => ({
        ...branch,
        isCheckedOut: checked.has(branch.name),
      }))

      const state = this.host.state()
      const configured = state?.getDefaultBaseBranch()
      if (state && configured && !branches.some((branch) => branch.name === configured)) {
        this.host.log(`Default base branch "${configured}" no longer exists, clearing`)
        state.setDefaultBaseBranch(undefined)
        this.host.push()
      }

      this.host.post({
        type: "agentManager.branches",
        projectId,
        branches,
        defaultBranch: result.defaultBranch,
      })
    } catch (error) {
      this.host.log(`Failed to list branches: ${error}`)
      this.host.post({ type: "agentManager.branches", projectId, branches: [], defaultBranch: "main" })
    }
  }

  async branch(branch: string, projectId?: string): Promise<void> {
    await this.run({ branch }, projectId)
  }

  async pr(url: string, projectId?: string): Promise<void> {
    await this.run({ url }, projectId)
  }

  private async run(target: { branch: string } | { url: string }, projectId?: string): Promise<void> {
    const manager = this.host.manager()
    const state = this.host.state()
    if (!manager || !state) {
      this.host.post({ type: "agentManager.importResult", projectId, success: false, message: "Not a git repository" })
      return
    }
    if (this.busy(projectId)) return
    this.importing = true
    const branch = "branch" in target
    const creating = branch ? "Creating worktree from branch..." : "Resolving PR..."
    const setup = branch ? "Running setup script..." : "Setting up worktree..."
    const duplicate = branch
      ? `Branch "${target.branch}" is already checked out in another worktree`
      : "This PR's branch is already checked out in another worktree"
    try {
      const progress = { type: "agentManager.worktreeSetup", projectId, status: "creating" } as const
      this.host.post({ ...progress, message: creating })
      const result = branch
        ? await manager.createWorktree({ existingBranch: target.branch })
        : await manager.createFromPR(target.url)
      const success = branch ? `Opened branch ${target.branch}` : `Opened PR branch ${result.branch}`
      const log = branch ? `Imported branch ${target.branch}` : `Imported PR ${target.url}`
      const worktree = state.addWorktree({
        branch: result.branch,
        path: result.path,
        parentBranch: result.parentBranch,
        remote: result.remote,
        branchOwned: false,
      })
      this.host.push()
      try {
        this.host.post({ ...progress, message: setup, branch: result.branch, worktreeId: worktree.id })
        await this.host.setup(result.path, result.branch, worktree.id)
        const session = await this.host.session(result.path, result.branch, worktree.id)
        if (!session) throw new Error("Failed to create session")
        state.addSession(session.id, worktree.id)
        this.host.register(session.id, result.path)
        this.host.ready(session.id, result, worktree.id)
        this.host.post({ type: "agentManager.importResult", projectId, success: true, message: success })
        this.host.log(`${log} as worktree ${worktree.id}`)
      } catch (error) {
        state.removeWorktree(worktree.id)
        await manager.removeWorktree(result.path)
        this.host.push()
        throw error
      }
    } catch (error) {
      this.importError(error, duplicate, projectId)
    } finally {
      this.importing = false
    }
  }

  private busy(projectId?: string): boolean {
    if (!this.importing) return false
    this.host.post({
      type: "agentManager.importResult",
      projectId,
      success: false,
      message: "Another import is already in progress",
    })
    return true
  }

  private importError(error: unknown, duplicate: string, projectId?: string): void {
    const raw = error instanceof Error ? error.message : String(error)
    const message = raw.includes("already used by worktree") || raw.includes("already checked out") ? duplicate : raw
    const code = classifyWorktreeError(message)
    this.host.post({ type: "agentManager.worktreeSetup", projectId, status: "error", message, errorCode: code })
    this.host.post({ type: "agentManager.importResult", projectId, success: false, message, errorCode: code })
  }
}
