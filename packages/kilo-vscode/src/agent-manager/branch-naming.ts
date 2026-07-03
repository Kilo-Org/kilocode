import { semanticBranchName } from "./branch-name"
import type { WorktreeStateManager } from "./WorktreeStateManager"

interface Prompt {
  sessionID: string
  text: string
  providerID?: string
  modelID?: string
}

interface Client {
  branchName: {
    generate: (
      parameters: {
        directory: string
        sessionID: string
        prompt: string
        providerID?: string
        modelID?: string
      },
      options: { throwOnError: true; signal: AbortSignal },
    ) => Promise<{ data: { branch: string | null } }>
  }
}

interface Manager {
  renameBranch: (path: string, current: string, branch: string) => Promise<string>
}

interface Deps {
  state: () => WorktreeStateManager | undefined
  manager: () => Manager | undefined
  client: (dir: string) => Promise<Client>
  settings: () => { enabled: boolean; prefix: string }
  push: () => void
  log: (msg: string) => void
}

export class BranchNamingController {
  private readonly requests = new Map<string, AbortController>()

  constructor(private readonly deps: Deps) {}

  prompt(input: Prompt): void {
    const state = this.deps.state()
    const session = state?.getSession(input.sessionID)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    if (!state || !worktree || worktree.autoNameSessionId !== input.sessionID) return
    if (!this.deps.settings().enabled) {
      state.clearAutoName(worktree.id)
      return
    }
    if (state.getSessions(worktree.id).length !== 1 || worktree.prNumber || worktree.prUrl) {
      state.clearAutoName(worktree.id)
      return
    }
    if (this.requests.has(worktree.id)) return

    const request = new AbortController()
    this.requests.set(worktree.id, request)
    void this.generate(worktree.id, input, request)
  }

  dispose(): void {
    for (const request of this.requests.values()) request.abort()
    this.requests.clear()
  }

  private async generate(id: string, input: Prompt, request: AbortController): Promise<void> {
    const initial = this.deps.state()?.getWorktree(id)
    if (!initial) return

    try {
      const client = await this.deps.client(initial.path)
      const { data } = await client.branchName.generate(
        {
          directory: initial.path,
          sessionID: input.sessionID,
          prompt: input.text,
          providerID: input.providerID,
          modelID: input.modelID,
        },
        { throwOnError: true, signal: request.signal },
      )
      if (!data.branch || request.signal.aborted) return
      await this.rename(id, input.sessionID, data.branch)
    } catch (error) {
      if (request.signal.aborted) return
      this.deps.log(`Skipped automatic branch naming: ${error}`)
    } finally {
      if (this.requests.get(id) === request) this.requests.delete(id)
    }
  }

  private async rename(id: string, sessionID: string, generated: string): Promise<void> {
    const state = this.deps.state()
    const manager = this.deps.manager()
    const worktree = state?.getWorktree(id)
    const cfg = this.deps.settings()
    if (!state || !manager || !worktree || !cfg.enabled) return
    if (worktree.autoNameSessionId !== sessionID || worktree.branchOwned !== true) return
    if (state.getSessions(id).length !== 1 || worktree.prNumber || worktree.prUrl) return

    const branch = semanticBranchName(generated, cfg.prefix)
    if (!branch) return
    const current = worktree.branch
    const renamed = await manager.renameBranch(worktree.path, current, branch)
    if (!state.renameOwnedBranch(id, current, renamed)) return
    this.deps.push()
    this.deps.log(`Automatically named branch from session ${sessionID}: ${renamed}`)
  }
}
