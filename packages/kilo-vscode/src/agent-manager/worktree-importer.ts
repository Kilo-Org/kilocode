import type { Session } from "@kilocode/sdk/v2/client"
import type { AgentManagerOutMessage } from "./types"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { classifyWorktreeError, normalizePath } from "./git-import"

type Worktree = ReturnType<WorktreeStateManager["addWorktree"]>

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

  async external(): Promise<void> {
    const manager = this.host.manager()
    const state = this.host.state()
    if (!manager || !state) {
      this.host.post({ type: "agentManager.externalWorktrees", worktrees: [] })
      return
    }

    try {
      const paths = new Set(state.getWorktrees().map((worktree) => worktree.path))
      const worktrees = await manager.listExternalWorktrees(paths)
      this.host.post({ type: "agentManager.externalWorktrees", worktrees })
    } catch (error) {
      this.host.log(`Failed to list external worktrees: ${error}`)
      this.host.post({ type: "agentManager.externalWorktrees", worktrees: [] })
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

  async path(path: string, branch: string): Promise<void> {
    const state = this.host.state()
    const manager = this.host.manager()
    if (!state || !manager) {
      this.host.post({ type: "agentManager.importResult", success: false, message: "State not initialized" })
      return
    }
    if (this.busy()) return

    this.importing = true
    let worktree: Worktree | undefined
    try {
      const paths = new Set(state.getWorktrees().map((worktree) => worktree.path))
      const externals = await manager.listExternalWorktrees(paths)
      if (!externals.some((worktree) => normalizePath(worktree.path) === normalizePath(path))) {
        this.host.post({
          type: "agentManager.importResult",
          success: false,
          message: "Path is not a valid worktree for this repository",
        })
        return
      }

      const base = await manager.resolveBaseBranch()
      worktree = state.addWorktree({ branch, path, parentBranch: base.branch, remote: base.remote })
      this.host.push()

      const session = await this.host.session(path, branch, worktree.id)
      if (!session) {
        state.removeWorktree(worktree.id)
        this.host.push()
        this.host.post({ type: "agentManager.importResult", success: false, message: "Failed to create session" })
        return
      }

      state.addSession(session.id, worktree.id)
      this.host.register(session.id, path)
      this.host.push()
      this.host.post({
        type: "agentManager.worktreeSetup",
        status: "ready",
        message: "Worktree imported",
        sessionId: session.id,
        branch,
        worktreeId: worktree.id,
      })
      this.host.post({
        type: "agentManager.sessionMeta",
        sessionId: session.id,
        mode: "worktree",
        branch,
        path,
        parentBranch: base.branch,
      })
      this.host.post({ type: "agentManager.importResult", success: true, message: `Imported ${branch}` })
      this.host.log(`Imported external worktree ${path} (${branch})`)
    } catch (error) {
      if (worktree) {
        state.removeWorktree(worktree.id)
        this.host.push()
      }
      const message = error instanceof Error ? error.message : String(error)
      this.host.post({ type: "agentManager.importResult", success: false, message })
    } finally {
      this.importing = false
    }
  }

  async all(): Promise<void> {
    if (this.busy()) return

    const manager = this.host.manager()
    const state = this.host.state()
    if (!manager || !state) {
      this.host.post({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }
    this.importing = true

    try {
      const paths = new Set(state.getWorktrees().map((worktree) => worktree.path))
      const externals = await manager.listExternalWorktrees(paths)
      if (externals.length === 0) {
        this.host.post({
          type: "agentManager.importResult",
          success: true,
          message: "No external worktrees to import",
        })
        return
      }

      const imported: string[] = []
      const base = await manager.resolveBaseBranch()
      for (const external of externals) {
        try {
          const worktree = state.addWorktree({
            branch: external.branch,
            path: external.path,
            parentBranch: base.branch,
            remote: base.remote,
          })
          const session = await this.host.session(external.path, external.branch, worktree.id)
          if (session) {
            state.addSession(session.id, worktree.id)
            this.host.register(session.id, external.path)
            imported.push(worktree.id)
            continue
          }
          state.removeWorktree(worktree.id)
        } catch (error) {
          this.host.log(`Failed to import external worktree ${external.path}: ${error}`)
        }
      }

      this.host.push()
      this.host.post({
        type: "agentManager.importResult",
        success: true,
        message: `Imported ${imported.length} worktree${imported.length !== 1 ? "s" : ""}`,
      })
      this.host.log(`Imported ${imported.length}/${externals.length} external worktrees`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.host.post({ type: "agentManager.importResult", success: false, message })
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
