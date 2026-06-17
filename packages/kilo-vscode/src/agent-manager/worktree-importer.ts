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

  async branches(): Promise<void> {
    const manager = this.host.manager()
    if (!manager) {
      this.host.post({ type: "agentManager.branches", branches: [], defaultBranch: "main" })
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
        branches,
        defaultBranch: result.defaultBranch,
      })
    } catch (error) {
      this.host.log(`Failed to list branches: ${error}`)
      this.host.post({ type: "agentManager.branches", branches: [], defaultBranch: "main" })
    }
  }

  async branch(branch: string): Promise<void> {
    const manager = this.host.manager()
    const state = this.host.state()
    if (!manager || !state) {
      this.host.post({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }
    if (this.busy()) return

    this.importing = true
    try {
      this.host.post({
        type: "agentManager.worktreeSetup",
        status: "creating",
        message: "Creating worktree from branch...",
      })
      const result = await manager.createWorktree({ existingBranch: branch })
      const worktree = state.addWorktree({
        branch: result.branch,
        path: result.path,
        parentBranch: result.parentBranch,
        remote: result.remote,
      })
      this.host.push()

      try {
        this.host.post({
          type: "agentManager.worktreeSetup",
          status: "creating",
          message: "Running setup script...",
          branch: result.branch,
          worktreeId: worktree.id,
        })
        await this.host.setup(result.path, result.branch, worktree.id)

        const session = await this.host.session(result.path, result.branch, worktree.id)
        if (!session) throw new Error("Failed to create session")

        state.addSession(session.id, worktree.id)
        this.host.register(session.id, result.path)
        this.host.ready(session.id, result, worktree.id)
        this.host.post({ type: "agentManager.importResult", success: true, message: `Opened branch ${branch}` })
        this.host.log(`Imported branch ${branch} as worktree ${worktree.id}`)
      } catch (error) {
        state.removeWorktree(worktree.id)
        await manager.removeWorktree(result.path)
        this.host.push()
        throw error
      }
    } catch (error) {
      this.importError(error, `Branch "${branch}" is already checked out in another worktree`)
    } finally {
      this.importing = false
    }
  }

  async pr(url: string): Promise<void> {
    const manager = this.host.manager()
    const state = this.host.state()
    if (!manager || !state) {
      this.host.post({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }
    if (this.busy()) return

    this.importing = true
    try {
      this.host.post({ type: "agentManager.worktreeSetup", status: "creating", message: "Resolving PR..." })
      const result = await manager.createFromPR(url)
      const worktree = state.addWorktree({
        branch: result.branch,
        path: result.path,
        parentBranch: result.parentBranch,
        remote: result.remote,
      })
      this.host.push()

      try {
        this.host.post({
          type: "agentManager.worktreeSetup",
          status: "creating",
          message: "Setting up worktree...",
          branch: result.branch,
          worktreeId: worktree.id,
        })
        await this.host.setup(result.path, result.branch, worktree.id)

        const session = await this.host.session(result.path, result.branch, worktree.id)
        if (!session) throw new Error("Failed to create session")

        state.addSession(session.id, worktree.id)
        this.host.register(session.id, result.path)
        this.host.ready(session.id, result, worktree.id)
        this.host.post({
          type: "agentManager.importResult",
          success: true,
          message: `Opened PR branch ${result.branch}`,
        })
        this.host.log(`Imported PR ${url} as worktree ${worktree.id}`)
      } catch (error) {
        state.removeWorktree(worktree.id)
        await manager.removeWorktree(result.path)
        this.host.push()
        throw error
      }
    } catch (error) {
      this.importError(error, "This PR's branch is already checked out in another worktree")
    } finally {
      this.importing = false
    }
  }

  private busy(): boolean {
    if (!this.importing) return false
    this.host.post({
      type: "agentManager.importResult",
      success: false,
      message: "Another import is already in progress",
    })
    return true
  }

  private importError(error: unknown, duplicate: string): void {
    const raw = error instanceof Error ? error.message : String(error)
    const message = raw.includes("already used by worktree") || raw.includes("already checked out") ? duplicate : raw
    const code = classifyWorktreeError(message)
    this.host.post({ type: "agentManager.worktreeSetup", status: "error", message, errorCode: code })
    this.host.post({ type: "agentManager.importResult", success: false, message, errorCode: code })
  }
}
