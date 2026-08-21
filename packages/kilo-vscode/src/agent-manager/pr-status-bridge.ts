/**
 * Bridges the PRStatusPoller with the AgentManagerProvider.
 *
 * Owns the poller instance, the cached PR messages, and all message/panel handling
 * so the provider only needs thin delegation calls.
 */
import type { Worktree } from "./WorktreeStateManager"
import type { AgentManagerOutMessage, PRStatus } from "./types"
import type { Disposable } from "./host"
import type { Semaphore } from "./semaphore"
import { PRStatusPoller } from "./PRStatusPoller"
import { resolveComment, unresolveComment } from "./pr/PRActions"
import { ghErrorReason } from "./pr/am-pr-utils"

interface PRBridgeHost {
  getWorktrees(): Worktree[]
  getWorkspaceRoot(): string | undefined
  postToWebview(msg: AgentManagerOutMessage): void
  updateWorktreePR(id: string, number?: number, url?: string, state?: string): void
  hasPersistedPR(id: string): boolean
  openExternal(url: string): void
  log(...args: unknown[]): void
  semaphore?: Semaphore
  projectId?: () => string | undefined
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
  private lastErrorNotified: "gh_missing" | "gh_auth" | "fetch_failed" | undefined

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
    semaphore?: Semaphore
    projectId?: () => string | undefined
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
    if (this.lastErrorNotified === "gh_auth" || this.lastErrorNotified === "gh_missing")
      this.host.postToWebview({ type: "agentManager.prError", error: this.lastErrorNotified } as AgentManagerOutMessage)
  }

  snapshot(): Map<string, PRStatus> {
    const result = new Map<string, PRStatus>()
    for (const [id, msg] of this.cache) {
      if (msg.type === "agentManager.prStatus" && msg.pr) result.set(id, msg.pr)
    }
    return result
  }

  /** Handle an incoming webview message. Returns true if handled. */
  handleMessage(m: Record<string, unknown>): boolean {
    if (m.type === "agentManager.refreshPR") {
      if (typeof m.projectId === "string" && m.projectId !== this.host.projectId?.()) return true
      this.poller.refresh(m.worktreeId as string)
      return true
    }
    if (m.type === "agentManager.openPR") {
      const explicit = typeof m.url === "string" ? m.url : undefined
      if (explicit) {
        this.host.openExternal(explicit)
        return true
      }
      if (typeof m.projectId === "string" && m.projectId !== this.host.projectId?.()) return true
      const url = this.host.getWorktrees().find((w: Worktree) => w.id === m.worktreeId)?.prUrl
      if (url) this.host.openExternal(url)
      return true
    }
    if (m.type === "agentManager.resolveComment" || m.type === "agentManager.unresolveComment")
      return this.handleComment(m)
    return false
  }

  private handleComment(m: Record<string, unknown>): boolean {
    const id = m.worktreeId as string
    const threadId = m.threadId as string
    const projectId = typeof m.projectId === "string" ? m.projectId : this.host.projectId?.()
    const wt = this.host.getWorktrees().find((w) => w.id === id)
    const cwd = wt?.path ?? this.host.getWorkspaceRoot()
    const resolve = m.type === "agentManager.resolveComment"
    const resultType = resolve ? "agentManager.resolveCommentResult" : "agentManager.unresolveCommentResult"
    const result = (success: boolean) =>
      this.host.postToWebview({
        type: resultType,
        ...(projectId ? { projectId } : {}),
        worktreeId: id,
        threadId,
        success,
      })
    if (!cwd) {
      this.host.log("resolveComment: no cwd for worktree", id)
      result(false)
      return true
    }
    const action = resolve ? resolveComment : unresolveComment
    action(threadId, cwd).then(
      () => {
        result(true)
        this.poller.refresh(id)
      },
      (err: unknown) => {
        this.host.log(`${resultType} failed: ${err instanceof Error ? err.message : String(err)}`)
        result(false)
      },
    )
    return true
  }

  /** Remove cached status for a deleted worktree. */
  remove(worktreeId: string): void {
    this.cache.delete(worktreeId)
  }

  reset(): void {
    this.poller.stop()
    this.cache.clear()
    this.lastErrorNotified = undefined
  }

  notifyError(err: "gh_missing" | "gh_auth" | "fetch_failed"): void {
    if (this.lastErrorNotified === err) return
    this.lastErrorNotified = err
    this.host.postToWebview({ type: "agentManager.prError", error: err } as AgentManagerOutMessage)
  }
}

/** Build PRStatusPoller options that forward events through the bridge cache. */
function bridgePollerOpts(bridge: PRStatusBridge, host: PRBridgeHost) {
  return {
    getWorktrees: () => host.getWorktrees(),
    getWorkspaceRoot: () => host.getWorkspaceRoot(),
    semaphore: host.semaphore,
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
            ...(host.projectId?.() ? { projectId: host.projectId() } : {}),
          } as AgentManagerOutMessage)
        // Always forward auth/missing errors so the webview can show a toast,
        // regardless of whether prior data exists. Deduplicate per error type
        // so multiple failing worktrees don't produce multiple toasts.
        if (err === "gh_auth" || err === "gh_missing") bridge.notifyError(err)
        return
      }
      const msg = {
        type: "agentManager.prStatus",
        worktreeId: id,
        pr,
        error: err,
        ...(host.projectId?.() ? { projectId: host.projectId() } : {}),
      } as AgentManagerOutMessage
      bridge["cache"].set(id, msg)
      bridge["lastErrorNotified"] = undefined
      host.postToWebview(msg)
      host.updateWorktreePR(id, pr?.number, pr?.url, pr?.state)
    },
    log: (...args: unknown[]) => host.log(...args),
  }
}
