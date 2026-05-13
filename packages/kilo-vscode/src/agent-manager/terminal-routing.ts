/**
 * Routes inbound terminal messages from the webview to a
 * `TerminalManager`, extracted from `AgentManagerProvider` so the
 * provider stays focused on session/worktree orchestration and the
 * max-lines cap on `AgentManagerProvider.ts` stays intact.
 *
 * Owns:
 *   - the `TerminalManager` lifecycle (create / close / resize / dispose)
 *   - the per-context "Terminal N" ordinal counter
 *   - cwd resolution (worktree path → workspace root fallback)
 *   - WebSocket URL construction with loopback `auth_token` auth
 *
 * Vscode-free: all VS Code access is funnelled through the `deps`
 * callbacks so this module is trivially unit-testable with fakes.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import { TerminalManager } from "./terminal-manager"

interface ServerConfig {
  baseUrl: string
  password: string
}

export interface TerminalRoutingDeps {
  /** Shared SDK client. Throws when the CLI backend is not connected. */
  getClient(): KiloClient
  /** Loopback URL + basic-auth password for the running `kilo serve`. */
  getServerConfig(): ServerConfig | undefined
  /** Workspace root — used as cwd fallback when no worktree is selected (LOCAL). */
  getRoot(): string | undefined
  /** Resolve a worktree id to its on-disk path, or undefined if unknown. */
  getWorktreePath(worktreeId: string): string | undefined
  /** Output channel log — prefixed by the caller. */
  log(...args: unknown[]): void
  /** Send a message back to the webview. */
  post(message: AgentManagerOutMessage): void
}

/** True iff the message belongs to the terminal-tab subsystem. */
function isTerminalMessage(
  m: AgentManagerInMessage,
): m is Extract<AgentManagerInMessage, { type: `agentManager.terminal.${string}` }> {
  return (
    m.type === "agentManager.terminal.create" ||
    m.type === "agentManager.terminal.close" ||
    m.type === "agentManager.terminal.resize"
  )
}

export class TerminalRouter {
  private readonly manager: TerminalManager
  private readonly ordinals = new Map<string, number>()

  constructor(private readonly deps: TerminalRoutingDeps) {
    this.manager = new TerminalManager({
      getClient: () => deps.getClient(),
      buildWsUrl: (ptyID, cwd) => this.buildWsUrl(ptyID, cwd),
      log: deps.log,
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
      void this.handleCreate(m.worktreeId)
      return true
    }
    if (m.type === "agentManager.terminal.close") {
      void this.manager.close(m.terminalId).then(() => {
        this.deps.post({ type: "agentManager.terminal.closed", terminalId: m.terminalId })
      })
      return true
    }
    // resize
    void this.manager.resize(m.terminalId, m.cols, m.rows)
    return true
  }

  /** Tear down every live PTY. Forwards to `TerminalManager.dispose`. */
  dispose(): Promise<void> {
    return this.manager.dispose()
  }

  private async handleCreate(worktreeId: string | null): Promise<void> {
    const cwd = this.resolveCwd(worktreeId)
    if (!cwd) {
      this.deps.post({
        type: "agentManager.terminal.error",
        message: "Open a folder before creating a terminal",
      })
      return
    }
    const title = `Terminal ${this.nextOrdinal(worktreeId)}`
    try {
      const created = await this.manager.create({ worktreeId, cwd, title })
      this.deps.post({
        type: "agentManager.terminal.created",
        worktreeId: created.worktreeId,
        terminalId: created.terminalId,
        title: created.title,
        wsUrl: created.wsUrl,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log(`Terminal create failed: ${message}`)
      this.deps.post({ type: "agentManager.terminal.error", message })
    }
  }

  /**
   * Resolve the cwd for a terminal in the given context.
   *
   * LOCAL (null) falls back to the workspace root; a worktree id
   * resolves to its on-disk path. Returns undefined when no folder is
   * open — the caller surfaces this as a user-facing error.
   */
  private resolveCwd(worktreeId: string | null): string | undefined {
    if (worktreeId === null) return this.deps.getRoot()
    return this.deps.getWorktreePath(worktreeId) ?? this.deps.getRoot()
  }

  /** Per-context counter so default titles are "Terminal 1", "Terminal 2"…
   *  Not persisted; a webview reload resets counts. */
  private nextOrdinal(worktreeId: string | null): number {
    const key = worktreeId ?? "__local__"
    const next = (this.ordinals.get(key) ?? 0) + 1
    this.ordinals.set(key, next)
    return next
  }

  /**
   * Build the WebSocket URL for a given PTY.
   *
   * Uses the `?auth_token=` query param the server already understands
   * (`packages/opencode/src/server/middleware.ts:48`): base64-encoded
   * `username:password`. Browsers cannot set HTTP headers on
   * `new WebSocket(...)`, so query-param auth is the only option. Safe
   * because the server binds loopback-only and the password rotates on
   * every `kilo serve` spawn.
   */
  private buildWsUrl(ptyID: string, cwd: string): string {
    const config = this.deps.getServerConfig()
    if (!config) throw new Error("Not connected to CLI backend")
    const base = config.baseUrl.replace(/^http/i, "ws")
    const token = Buffer.from(`kilo:${config.password}`).toString("base64")
    const dir = encodeURIComponent(cwd)
    const auth = encodeURIComponent(token)
    return `${base}/pty/${encodeURIComponent(ptyID)}/connect?directory=${dir}&cursor=-1&auth_token=${auth}`
  }
}
