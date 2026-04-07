/**
 * Bridges the PRStatusPoller with the AgentManagerProvider.
 *
 * Owns the poller instance, the cached PR messages, and all message/panel handling
 * so the provider only needs thin delegation calls.
 */
import type { Worktree } from "./WorktreeStateManager"
import type { AgentManagerOutMessage, PRStatus } from "./types"
import type { Disposable } from "./host"
import { PRStatusPoller } from "./PRStatusPoller"

interface PRBridgeHost {
  getWorktrees(): Worktree[]
  getWorkspaceRoot(): string | undefined
  postToWebview(msg: AgentManagerOutMessage): void
  updateWorktreePR(id: string, number?: number, url?: string, state?: string): void
  hasPersistedPR(id: string): boolean
  openExternal(url: string): void
  log(...args: unknown[]): void
}

/** Minimal panel surface needed by the bridge (subset of PanelContext). */
interface PanelLike {
  readonly visible: boolean
  onDidChangeVisibility(cb: (visible: boolean) => void): Disposable
}

export class PRStatusBridge {
  readonly poller: PRStatusPoller
  private readonly cache = new Map<string, AgentManagerOutMessage>()
  private readonly host: PRBridgeHost

  constructor(host: PRBridgeHost) {
    this.host = host
    this.poller = new PRStatusPoller(bridgePollerOpts(this, host))
  }

  static create(opts: {
    getWorktrees: () => Worktree[]
    getWorkspaceRoot: () => string | undefined
    postToWebview: (msg: AgentManagerOutMessage) => void
    updateWorktreePR: (id: string, n?: number, u?: string, s?: string) => void
    hasPersistedPR: (id: string) => boolean
    openExternal: (url: string) => void
    log: (...args: unknown[]) => void
  }): PRStatusBridge {
    return new PRStatusBridge(opts)
  }

  /** Wire visibility tracking to a panel — pauses polling when hidden. */
  attachPanel(panel: PanelLike): void {
    this.poller.setVisible(panel.visible)
    panel.onDidChangeVisibility((v) => {
      this.poller.setVisible(v)
    })
  }

  /** Replay cached PR statuses to a freshly-connected webview. */
  replay(): void {
    this.cache.forEach((msg) => this.host.postToWebview(msg))
  }

  /** Handle an incoming webview message. Returns true if handled. */
  handleMessage(m: Record<string, unknown>): boolean {
    if (m.type === "agentManager.refreshPR") {
      this.poller.refresh(m.worktreeId as string)
      return true
    }
    if (m.type === "agentManager.openPR") {
      const wt = this.host.getWorktrees().find((w: Worktree) => w.id === m.worktreeId)
      if (wt?.prUrl) this.host.openExternal(wt.prUrl)
      return true
    }
    return false
  }

  /** Remove cached status for a deleted worktree. */
  remove(worktreeId: string): void {
    this.cache.delete(worktreeId)
  }
}

/** Build PRStatusPoller options that forward events through the bridge cache. */
function bridgePollerOpts(bridge: PRStatusBridge, host: PRBridgeHost) {
  return {
    getWorktrees: () => host.getWorktrees(),
    getWorkspaceRoot: () => host.getWorkspaceRoot(),
    onStatus: (id: string, pr: PRStatus | null, err?: "gh_missing" | "gh_auth" | "fetch_failed") => {
      if (err) {
        // Don't forward errors to the webview when we have prior PR data
        // (in-memory cache or persisted prNumber) — that would overwrite
        // the live badge with pr:null. Only forward when there's truly no
        // prior data (first poll failed, nothing persisted).
        if (!bridge["cache"].has(id) && !host.hasPersistedPR(id))
          host.postToWebview({
            type: "agentManager.prStatus",
            worktreeId: id,
            pr: null,
            error: err,
          } as AgentManagerOutMessage)
        return
      }
      const msg = { type: "agentManager.prStatus", worktreeId: id, pr, error: err } as AgentManagerOutMessage
      bridge["cache"].set(id, msg)
      host.postToWebview(msg)
      host.updateWorktreePR(id, pr?.number, pr?.url, pr?.state)
    },
    log: (...args: unknown[]) => host.log(...args),
  }
}
