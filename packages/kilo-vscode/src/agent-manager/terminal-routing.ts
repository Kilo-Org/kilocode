/**
 * Routes inbound terminal messages from the webview to a `TerminalManager`,
 * extracted from `AgentManagerProvider` so the provider stays focused on
 * session/worktree orchestration and the max-lines cap on
 * `AgentManagerProvider.ts` stays intact.
 *
 * Owns:
 *   - the `TerminalManager` lifecycle (create / close / resize / restart)
 *   - the per-context "Terminal N" ordinal counter
 *   - cwd resolution (selected worktree or workspace root)
 *
 * Vscode-free: all VS Code access is funnelled through the `deps` callbacks so
 * this module is trivially unit-testable with fakes.
 */

import type { AgentManagerConnection } from "./connection"
import { getErrorMessage } from "./errors"
import type { AgentManagerInMessage, AgentManagerOutMessage, TerminalFont, TerminalPlacement } from "./types"
import { TerminalManager } from "./terminal-manager"

export interface TerminalRoutingDeps {
  /** The Agent Manager connection; every PTY call carries its own directory. */
  connection: AgentManagerConnection
  /** Workspace root, used as cwd fallback when no worktree is selected (LOCAL). */
  getRoot(): string | undefined
  /** Resolve a worktree id to its on-disk path, or undefined if unknown. */
  getWorktreePath(worktreeId: string): string | undefined
  /** Project the current message is dispatched for; stamped onto
   *  `terminal.created` so the webview can namespace its per-project
   *  terminal state (worktree ids collide across projects). */
  getProjectId(): string | undefined
  /** Output channel log, prefixed by the caller. */
  log(...args: unknown[]): void
  /** Send a message back to the webview. */
  post(message: AgentManagerOutMessage): void
  /** A terminal is gone, so its relay sockets must close too. */
  closed(terminalId: string): void
  /** Return the current terminal font settings. */
  getTerminalFont(): TerminalFont
}

type RoutedTerminalMessage =
  | Extract<AgentManagerInMessage, { type: "agentManager.terminal.create" }>
  | Extract<AgentManagerInMessage, { type: "agentManager.terminal.close" }>
  | Extract<AgentManagerInMessage, { type: "agentManager.terminal.resize" }>
  | Extract<AgentManagerInMessage, { type: "agentManager.terminal.restart" }>

/** True iff the message belongs to the terminal-tab subsystem. */
function isTerminalMessage(m: AgentManagerInMessage): m is RoutedTerminalMessage {
  return (
    m.type === "agentManager.terminal.create" ||
    m.type === "agentManager.terminal.close" ||
    m.type === "agentManager.terminal.resize" ||
    m.type === "agentManager.terminal.restart"
  )
}

export class TerminalRouter {
  private manager: TerminalManager
  /** Keep failed cleanup reachable after a panel replaces its manager. */
  private readonly retired = new Set<TerminalManager>()
  /** Includes creates waiting for the shared server connection. */
  private readonly creates = new Map<TerminalManager, number>()
  /** Ordinals reserved by in-flight creates, per context, which prevents two
   *  concurrent creates from grabbing the same "Terminal N" title. */
  private readonly reserved = new Map<string, Set<number>>()
  private generation = 0

  constructor(private readonly deps: TerminalRoutingDeps) {
    this.manager = this.createManager()
  }

  private createManager(): TerminalManager {
    return new TerminalManager({
      connection: this.deps.connection,
      log: this.deps.log,
    })
  }

  /**
   * Attempt to handle `m` as a terminal message.
   * Returns `true` if the router consumed it, `false` otherwise so the
   * provider's main `onMessage` switch can fall through.
   */
  handle(m: AgentManagerInMessage): boolean {
    if (!isTerminalMessage(m)) return false
    if (m.type === "agentManager.terminal.create") {
      void this.handleCreate(m.createId, m.placement, m.worktreeId, m.cols, m.rows)
      return true
    }
    if (m.type === "agentManager.terminal.close") {
      void this.manager.close(m.terminalId).then((closed) => {
        if (closed) this.deps.closed(m.terminalId)
        this.deps.post(
          closed
            ? { type: "agentManager.terminal.closed", terminalId: m.terminalId }
            : {
                type: "agentManager.terminal.error",
                terminalId: m.terminalId,
                message: "Failed to close terminal; it remains available for retry",
              },
        )
      })
      return true
    }
    if (m.type === "agentManager.terminal.restart") {
      void this.manager
        .restart(m.terminalId, m.cols, m.rows)
        .then((restarted) => {
          if (!restarted) return
          this.deps.post({ type: "agentManager.terminal.restarted", terminalId: m.terminalId })
        })
        .catch((error: unknown) => {
          this.deps.post({
            type: "agentManager.terminal.error",
            terminalId: m.terminalId,
            message: getErrorMessage(error),
          })
        })
        .finally(() => this.prune())
      return true
    }
    // resize
    void this.manager.resize(m.terminalId, m.cols, m.rows)
    return true
  }

  /** The server PTY behind a webview terminal, for the host socket relay. */
  ptyFor(terminalId: string): { ptyID: string; directory: string } | undefined {
    return this.manager.ptyFor(terminalId) ?? [...this.retired].map((entry) => entry.ptyFor(terminalId)).find(Boolean)
  }

  /**
   * Tear down every live PTY and invalidate in-flight create requests.
   * The router stays usable afterwards: a create landing from before the
   * disposal is closed immediately instead of leaking a PTY the webview
   * no longer tracks.
   */
  dispose(): Promise<void> {
    this.generation++
    const manager = this.manager
    this.manager = this.createManager()
    this.retired.add(manager)
    this.reserved.clear()
    return Promise.all([...this.retired].map((entry) => entry.dispose())).then(() => this.prune())
  }

  async blockDirectory(directory: string): Promise<() => void> {
    const releases = await Promise.all(
      [this.manager, ...this.retired].map((manager) => manager.blockDirectory(directory)),
    )
    return () => {
      for (const release of releases) release()
    }
  }

  async closeDirectory(directory: string): Promise<void> {
    try {
      await Promise.all([this.manager, ...this.retired].map((manager) => manager.closeDirectory(directory)))
    } finally {
      this.prune()
    }
  }

  private prune(): void {
    for (const manager of this.retired) {
      if (!this.creates.has(manager) && !manager.hasPendingCleanup()) this.retired.delete(manager)
    }
  }

  private async handleCreate(
    createId: string,
    placement: TerminalPlacement,
    worktreeId: string | null,
    cols?: number,
    rows?: number,
  ): Promise<void> {
    const generation = this.generation
    const manager = this.manager
    const cwd = this.resolveCwd(worktreeId)
    // Captured synchronously: the project scope is only current while the
    // dispatch runs, not when the async create settles.
    const pid = this.deps.getProjectId()
    if (!cwd) {
      this.deps.post({
        type: "agentManager.terminal.error",
        createId,
        message: worktreeId
          ? "The selected worktree is no longer available"
          : "Open a folder before creating a terminal",
      })
      return
    }
    const ordinal = this.reserveOrdinal(worktreeId)
    const title = `Terminal ${ordinal}`
    this.creates.set(manager, (this.creates.get(manager) ?? 0) + 1)
    try {
      // Join the shared server connection instead of racing its synchronous
      // client accessor when this is the first Kilo action in the window.
      await this.deps.connection.client()
      const created = await manager.create({ terminalId: createId, worktreeId, cwd, title, cols, rows })
      if (generation !== this.generation) {
        await manager.close(created.terminalId)
        return
      }
      this.deps.post({
        type: "agentManager.terminal.created",
        createId,
        placement,
        worktreeId: created.worktreeId,
        ...(pid ? { projectId: pid } : {}),
        terminalId: created.terminalId,
        title: created.title,
        font: this.deps.getTerminalFont(),
      })
    } catch (error) {
      if (generation !== this.generation) return
      const message = getErrorMessage(error)
      this.deps.log(`Terminal create failed: ${message}`)
      this.deps.post({ type: "agentManager.terminal.error", createId, message })
    } finally {
      // Only a current-generation create may release: dispose() already
      // cleared this create's reservation, and releasing here would
      // delete a *new* panel's reservation for the same number.
      if (generation === this.generation) this.releaseOrdinal(worktreeId, ordinal)
      const count = this.creates.get(manager) ?? 1
      if (count === 1) this.creates.delete(manager)
      else this.creates.set(manager, count - 1)
      this.prune()
    }
  }

  /**
   * Resolve the cwd for a terminal in the given context.
   *
   * LOCAL (null) uses the workspace root; a worktree id resolves strictly
   * to its on-disk path. Silently falling back to the workspace root would
   * run the shell in the wrong directory. Returns undefined when no folder is
   * open or the worktree is gone; the caller surfaces this as a user-facing
   * error.
   */
  private resolveCwd(worktreeId: string | null): string | undefined {
    if (worktreeId === null) return this.deps.getRoot()
    return this.deps.getWorktreePath(worktreeId)
  }

  /**
   * Pick the lowest "Terminal N" ordinal not used by a live terminal or
   * an in-flight create in this context, and reserve it until the
   * create settles. Gap-filling keeps numbering consistent: closing
   * "Terminal 1" of three frees 1 for the next terminal, instead of
   * drifting to ever-higher numbers. Not persisted; a webview reload
   * resets the live set.
   */
  private reserveOrdinal(worktreeId: string | null): number {
    const key = worktreeId ?? "__local__"
    const used = new Set<number>()
    for (const title of this.manager.titles(worktreeId)) {
      const match = /^Terminal (\d+)$/.exec(title)
      if (match) used.add(Number(match[1]))
    }
    const pending = this.reserved.get(key)
    if (pending) for (const n of pending) used.add(n)
    let next = 1
    while (used.has(next)) next++
    const set = pending ?? new Set<number>()
    set.add(next)
    this.reserved.set(key, set)
    return next
  }

  /** Return an in-flight create's reservation. */
  private releaseOrdinal(worktreeId: string | null, ordinal: number) {
    const key = worktreeId ?? "__local__"
    const set = this.reserved.get(key)
    if (!set) return
    set.delete(ordinal)
    if (set.size === 0) this.reserved.delete(key)
  }
}