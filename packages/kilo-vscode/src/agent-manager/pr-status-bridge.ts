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
import { ghErrorReason, mergePRStatus } from "./pr/am-pr-utils"

interface PRBridgeHost {
  getWorktrees(): Worktree[]
  getWorkspaceRoot(): string | undefined
  postToWebview(msg: AgentManagerOutMessage): void
  updateWorktreePR(id: string, number?: number, url?: string, state?: string): void
  hasPersistedPR(id: string): boolean
  openExternal(url: string): void
  log(...args: unknown[]): void
  semaphore?: Semaphore
}

/** Minimal panel surface needed by the bridge (subset of PanelContext). */
interface PanelLike {
  readonly visible: boolean
  onDidChangeVisibility(cb: (visible: boolean) => void): Disposable
}

export class PRStatusBridge {
  readonly poller: PRStatusPoller
  private readonly cache = new Map<string, AgentManagerOutMessage>()
  /** Branch each cached PR was found on, so a branch switch still clears it. */
  private readonly branches = new Map<string, string>()
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
      this.poller.refresh(m.worktreeId as string)
      return true
    }
    if (m.type === "agentManager.openPR") {
      const url = (m.url as string) ?? this.host.getWorktrees().find((w: Worktree) => w.id === m.worktreeId)?.prUrl
      if (url) this.host.openExternal(url)
      return true
    }
    const isResolve = m.type === "agentManager.resolveComment"
    const isUnresolve = m.type === "agentManager.unresolveComment"
    if (isResolve || isUnresolve) {
      const id = m.worktreeId as string
      const threadId = m.threadId as string
      const wt = this.host.getWorktrees().find((w: Worktree) => w.id === id)
      const cwd = wt?.path ?? this.host.getWorkspaceRoot()
      const resultType = isResolve ? "agentManager.resolveCommentResult" : "agentManager.unresolveCommentResult"
      if (!cwd) {
        this.host.log("resolveComment: no cwd for worktree", id)
        this.host.postToWebview({
          type: resultType,
          worktreeId: id,
          threadId,
          success: false,
        })
        return true
      }
      const action = isResolve ? resolveComment : unresolveComment
      action(threadId, cwd).then(
        () => {
          this.host.postToWebview({
            type: resultType,
            worktreeId: id,
            threadId,
            success: true,
          })
          // Refresh PR data after successful mutation to get updated comment state
          this.poller.refresh(id)
        },
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          this.host.log(`${resultType} failed: ${msg}`)
          this.host.postToWebview({
            type: resultType,
            worktreeId: id,
            threadId,
            success: false,
            error: ghErrorReason(msg),
          })
        },
      )
      return true
    }
    return false
  }

  /** Remove cached status for a deleted worktree. */
  remove(worktreeId: string): void {
    this.cache.delete(worktreeId)
    this.branches.delete(worktreeId)
  }

  reset(): void {
    this.poller.stop()
    this.cache.clear()
    this.branches.clear()
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
        reportError(bridge, host, id, err)
        return
      }
      accept(bridge, host, id, pr)
    },
    log: (...args: unknown[]) => host.log(...args),
  }
}

function reportError(
  bridge: PRStatusBridge,
  host: PRBridgeHost,
  id: string,
  err: "gh_missing" | "gh_auth" | "fetch_failed",
): void {
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
  // Always forward auth/missing errors so the webview can show a toast,
  // regardless of whether prior data exists. Deduplicate per error type
  // so multiple failing worktrees don't produce multiple toasts.
  if (err === "gh_auth" || err === "gh_missing") bridge.notifyError(err)
}

function accept(bridge: PRStatusBridge, host: PRBridgeHost, id: string, pr: PRStatus | null): void {
  const cached = bridge["cache"].get(id)
  const prev = cached?.type === "agentManager.prStatus" ? cached.pr : null
  const branch = host.getWorktrees().find((w: Worktree) => w.id === id)?.branch
  // `gh` answers "no pull request" for a rate limit, a network blip, or an
  // unresolvable fork ref exactly as it does for a branch that never had one. A
  // PR cannot leave a branch, so on the same branch the known PR is kept:
  // forwarding pr:null would unmount the panel and throw away the comment the
  // user is reading.
  if (!pr && prev && branch !== undefined && bridge["branches"].get(id) === branch) {
    host.log(`PR status: keeping PR #${prev.number} for ${id}, empty result on ${branch}`)
    return
  }
  const merged = pr && prev ? mergePRStatus(prev, pr) : pr
  const msg = { type: "agentManager.prStatus", worktreeId: id, pr: merged } as AgentManagerOutMessage
  bridge["cache"].set(id, msg)
  if (pr && branch !== undefined) bridge["branches"].set(id, branch)
  if (!pr) bridge["branches"].delete(id)
  bridge["lastErrorNotified"] = undefined
  host.postToWebview(msg)
  host.updateWorktreePR(id, pr?.number, pr?.url, pr?.state)
}
