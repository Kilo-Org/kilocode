import { semanticBranchName } from "./branch-name"
import { remoteRef, type WorktreeStateManager } from "./WorktreeStateManager"

/** Maximum prompts considered for automatic naming before disarming. */
const MAX_PROMPTS = 4

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
  hasWork: (worktreePath: string, base: string) => Promise<boolean>
}

interface Deps {
  state: () => WorktreeStateManager | undefined
  manager: () => Manager | undefined
  client: (dir: string) => Promise<Client>
  settings: () => { enabled: boolean; prefix: string }
  push: () => void
  log: (msg: string) => void
}

interface Pending {
  sessionID: string
  branch: string
}

export class BranchNamingController {
  private readonly requests = new Map<string, AbortController>()
  private readonly busySessions = new Set<string>()
  private readonly pending = new Map<string, Pending>()
  private readonly idleAttempted = new Set<string>()
  private readonly model = new Map<string, { providerID?: string; modelID?: string }>()

  constructor(private readonly deps: Deps) {}

  /** Called for every outgoing user message. Defers naming until intent is clear:
   *  the first message only arms, messages 2-4 may name, after that disarm. */
  prompt(input: Prompt): void {
    const { state, worktree } = this.resolve(input.sessionID)
    if (!state || !worktree || worktree.autoNameSessionId !== input.sessionID) return
    if (!this.deps.settings().enabled) {
      this.disarm(worktree.id)
      return
    }
    if (state.getSessions(worktree.id).length !== 1 || worktree.prNumber || worktree.prUrl) {
      this.disarm(worktree.id)
      return
    }
    this.model.set(worktree.id, { providerID: input.providerID, modelID: input.modelID })
    this.idleAttempted.delete(worktree.id)
    const count = state.incrementAutoNameCount(worktree.id)
    if (count === undefined) return
    if (count > MAX_PROMPTS) {
      this.disarm(worktree.id)
      return
    }
    if (count < 2) return
    if (this.requests.has(worktree.id) || this.pending.has(worktree.id)) return
    this.dispatch(worktree.id, input)
  }

  /** Mark a session busy so the rename is deferred to the next idle transition.
   *  Only armed sessions are tracked to keep the set bounded. */
  busy(sessionID: string): void {
    const { worktree } = this.resolve(sessionID)
    if (worktree?.autoNameSessionId !== sessionID) return
    this.busySessions.add(sessionID)
  }

  /** Called when a session becomes idle. Triggers generation once when the
   *  worktree already has changes (covering a single detailed first prompt),
   *  and applies any rename that was held while the session was busy. */
  idle(sessionID: string): void {
    this.busySessions.delete(sessionID)
    const { state, worktree } = this.resolve(sessionID)
    if (state && worktree && worktree.autoNameSessionId === sessionID) {
      const count = worktree.autoNamePromptCount ?? 0
      if (count === 1 && !this.idleAttempted.has(worktree.id) && !this.requests.has(worktree.id)) {
        this.idleAttempted.add(worktree.id)
        void this.generateOnIdle(worktree.id, sessionID)
      }
    }
    this.applyPending(sessionID)
  }

  dispose(): void {
    for (const request of this.requests.values()) request.abort()
    this.requests.clear()
    this.pending.clear()
  }

  private resolve(sessionID: string) {
    const state = this.deps.state()
    const session = state?.getSession(sessionID)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    return { state, worktree }
  }

  /** Clear persisted arming plus the controller's in-memory bookkeeping. */
  private disarm(id: string): void {
    this.deps.state()?.clearAutoName(id)
    this.forget(id)
  }

  /** Drop in-memory bookkeeping for a worktree whose arming ended without a
   *  rename (worktree removed, session moved/deleted). Safe to call for any
   *  id; no-ops when nothing is held. */
  forget(id: string): void {
    this.pending.delete(id)
    this.model.delete(id)
    this.idleAttempted.delete(id)
  }

  private dispatch(id: string, input: Prompt): void {
    const request = new AbortController()
    this.requests.set(id, request)
    void this.generate(id, input, request)
  }

  private async generateOnIdle(id: string, sessionID: string): Promise<void> {
    const state = this.deps.state()
    const manager = this.deps.manager()
    const worktree = state?.getWorktree(id)
    if (!state || !manager || !worktree || worktree.autoNameSessionId !== sessionID) return
    if (!this.deps.settings().enabled) {
      this.disarm(id)
      return
    }
    if (state.getSessions(id).length !== 1 || worktree.prNumber || worktree.prUrl) {
      this.disarm(id)
      return
    }
    const ref = this.model.get(id)
    const has = await manager.hasWork(worktree.path, remoteRef(worktree)).catch(() => false)
    if (!has) return
    if (this.requests.has(id)) return
    this.dispatch(id, { sessionID, text: "", providerID: ref?.providerID, modelID: ref?.modelID })
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
      // Hold the name: if busy, stash it as pending (the request slot frees
      // immediately, but prompt() refuses to dispatch while a rename is
      // pending); otherwise apply it now, keeping the slot occupied until it
      // settles so a fast next prompt does not dispatch a redundant generation.
      await this.queueRename(id, input.sessionID, data.branch)
    } catch (error) {
      if (request.signal.aborted) return
      this.deps.log(`Skipped automatic branch naming: ${error}`)
    } finally {
      if (this.requests.get(id) === request) this.requests.delete(id)
    }
  }

  private async queueRename(id: string, sessionID: string, generated: string): Promise<void> {
    if (this.busySessions.has(sessionID)) {
      this.pending.set(id, { sessionID, branch: generated })
      return
    }
    await this.applyRename(id, sessionID, generated)
  }

  private applyPending(sessionID: string): void {
    const { worktree } = this.resolve(sessionID)
    if (!worktree) return
    const pending = this.pending.get(worktree.id)
    if (!pending) return
    this.pending.delete(worktree.id)
    void this.applyRename(worktree.id, pending.sessionID, pending.branch)
  }

  private async applyRename(id: string, sessionID: string, generated: string): Promise<void> {
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
    // Called fire-and-forget: swallow rename failures into the log instead of
    // an unhandled rejection, and stay armed so a later message can retry.
    const renamed = await manager.renameBranch(worktree.path, current, branch).catch((error) => {
      this.deps.log(`Skipped automatic branch naming: ${error}`)
      return undefined
    })
    if (!renamed) return
    if (!state.renameOwnedBranch(id, current, renamed)) return
    this.forget(id)
    this.deps.push()
    this.deps.log(`Automatically named branch from session ${sessionID}: ${renamed}`)
  }
}
