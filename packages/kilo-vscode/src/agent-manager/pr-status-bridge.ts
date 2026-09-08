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
import {
  addCommentReaction,
  isPRReactionContent,
  removeCommentReaction,
  replyComment,
  resolveComment,
  unresolveComment,
} from "./pr/PRActions"
import { ghErrorReason, mergePRStatus, retainPRStatus } from "./pr/am-pr-utils"
import { mutateComment } from "./pr/mutate-comment"
import { PRReviewActions } from "./pr/review-actions"
import { PRSuggestionActions } from "./pr/suggestion-actions"
import type { PRReviewContext, PRReviewHost } from "./pr/review-context"

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
  dirtyFiles?: () => string[]
}

/** Minimal panel surface needed by the bridge (subset of PanelContext). */
interface PanelLike {
  readonly visible: boolean
  onDidChangeVisibility(cb: (visible: boolean) => void): Disposable
}

interface ReactionRequest {
  id: string
  commentId: string
  content: Parameters<typeof addCommentReaction>[1]
  add: boolean
}

function reactionRequest(m: Record<string, unknown>): ReactionRequest | undefined {
  if (typeof m.worktreeId !== "string") return
  if (typeof m.commentId !== "string") return
  if (!isPRReactionContent(m.reaction)) return
  if (typeof m.add !== "boolean") return
  return { id: m.worktreeId, commentId: m.commentId, content: m.reaction, add: m.add }
}

function hasComment(pr: PRStatus, id: string): boolean {
  return (
    pr.comments?.comments.some((comment) => comment.id === id || comment.replies?.some((reply) => reply.id === id)) ||
    pr.conversation?.some((comment) => comment.id === id) ||
    false
  )
}

export class PRStatusBridge {
  readonly poller: PRStatusPoller
  private reviews: PRReviewActions
  private suggestions: PRSuggestionActions
  private readonly cache = new Map<string, AgentManagerOutMessage>()
  /** Branch each cached PR was found on, so a branch switch still clears it. */
  private readonly branches = new Map<string, string>()
  private readonly host: PRBridgeHost
  private readonly actionHost: PRReviewHost
  private lastErrorNotified: "gh_missing" | "gh_auth" | "fetch_failed" | undefined

  constructor(host: PRBridgeHost) {
    this.host = host
    this.poller = new PRStatusPoller(bridgePollerOpts(this, host))
    const actions: PRReviewHost = {
      context: (message) => this.context(message),
      post: (message) => host.postToWebview(message),
      refresh: (context) => {
        if (host.projectId?.() === context.projectId) this.poller.refresh(context.worktreeId)
      },
      dirtyFiles: () => host.dirtyFiles?.() ?? [],
    }
    this.actionHost = actions
    this.reviews = new PRReviewActions(actions)
    this.suggestions = new PRSuggestionActions(actions)
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
    dirtyFiles?: () => string[]
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
      this.error(this.lastErrorNotified)
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
    if (this.reviews.handle(m) || this.suggestions.handle(m)) return true
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
    if (m.type === "agentManager.commentReaction") return this.handleReaction(m)
    if (
      m.type === "agentManager.replyComment" ||
      m.type === "agentManager.mutateComment" ||
      m.type === "agentManager.resolveComment" ||
      m.type === "agentManager.unresolveComment"
    )
      return this.comment(m, `${m.type}Result`)
    return false
  }

  private handleReaction(m: Record<string, unknown>): boolean {
    if (typeof m.projectId === "string" && m.projectId !== this.host.projectId?.()) return true
    const request = reactionRequest(m)
    if (!request) return true
    const { id, commentId, content, add } = request
    const projectId = typeof m.projectId === "string" ? m.projectId : this.host.projectId?.()
    const result = (success: boolean, error?: string) => {
      this.host.postToWebview({
        type: "agentManager.commentReactionResult",
        ...(projectId ? { projectId } : {}),
        worktreeId: id,
        commentId,
        reaction: content,
        add,
        success,
        ...(error ? { error } : {}),
      })
    }
    const wt = this.host.getWorktrees().find((item) => item.id === id)
    const cached = this.cache.get(id)
    const pr = cached?.type === "agentManager.prStatus" ? cached.pr : undefined
    if (!wt || this.branches.get(id) !== wt.branch || !pr || !hasComment(pr, commentId)) {
      result(false, "PR comment not found. Refresh and try again.")
      return true
    }
    const action = add ? addCommentReaction : removeCommentReaction
    action(commentId, content, wt.path).then(
      () => {
        result(true)
        if (this.host.projectId?.() === projectId) this.poller.refresh(id)
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.host.log(`commentReaction failed: ${message}`)
        result(false, ghErrorReason(message))
      },
    )
    return true
  }

  private context(m: Record<string, unknown>): PRReviewContext {
    const projectId = this.host.projectId?.()
    if (m.projectId !== undefined && m.projectId !== projectId)
      throw new Error("Project changed. Reopen the PR review.")
    const wt = this.host.getWorktrees().find((item) => item.id === m.worktreeId)
    const cached = wt && this.cache.get(wt.id)
    if (!wt || this.branches.get(wt.id) !== wt.branch || cached?.type !== "agentManager.prStatus" || !cached.pr) {
      throw new Error("Pull request not found in this worktree.")
    }
    if (m.prNumber !== cached.pr.number || m.prUrl !== cached.pr.url)
      throw new Error("Pull request changed. Refresh and try again.")
    return { pr: cached.pr, directory: wt.path, worktreeId: wt.id, projectId, branch: wt.branch }
  }

  private comment(
    m: Record<string, unknown>,
    type:
      | "agentManager.replyCommentResult"
      | "agentManager.mutateCommentResult"
      | "agentManager.resolveCommentResult"
      | "agentManager.unresolveCommentResult",
  ): boolean {
    const explicit =
      m.type === "agentManager.mutateComment" ? m.projectId !== undefined : typeof m.projectId === "string"
    const id = m.worktreeId as string
    const current = this.host.projectId?.()
    const requested = typeof m.projectId === "string" ? m.projectId : undefined
    const projectId = explicit ? requested : current
    const result = (success: boolean, error?: string) => {
      const route = {
        ...(projectId ? { projectId } : {}),
        worktreeId: id,
        success,
        ...(error ? { error } : {}),
      }
      const requestId = m.requestId as string
      const threadId = m.threadId as string
      this.host.postToWebview(
        type === "agentManager.mutateCommentResult"
          ? { ...route, type, requestId }
          : type === "agentManager.replyCommentResult"
            ? { ...route, type, requestId, threadId }
            : { ...route, type, threadId },
      )
    }
    if (explicit && requested !== current) {
      result(false, "Project changed. Reopen the PR review.")
      return true
    }
    const fail = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      this.host.log(`${type} failed: ${message}`)
      result(false, ghErrorReason(message))
    }
    try {
      const task = this.action(m)
      if (!task) result(false)
      task?.then(() => {
        result(true)
        if (this.host.projectId?.() === projectId) this.poller.refresh(id)
      }, fail)
    } catch (err) {
      fail(err)
    }
    return true
  }

  private action(m: Record<string, unknown>): Promise<void> | undefined {
    const id = m.worktreeId as string
    const threadId = m.threadId as string
    const wt = this.host.getWorktrees().find((w) => w.id === id)
    if (m.type === "agentManager.resolveComment" || m.type === "agentManager.unresolveComment") {
      // Only legacy resolve actions may fall back to the workspace directory.
      const cwd = wt?.path ?? this.host.getWorkspaceRoot()
      if (!cwd) {
        this.host.log("resolveComment: no cwd for worktree", id)
        return
      }
      const action = m.type === "agentManager.resolveComment" ? resolveComment : unresolveComment
      return action(threadId, cwd)
    }
    if (m.type === "agentManager.replyComment" && (typeof m.body !== "string" || !m.body.trim()))
      throw new Error("Reply cannot be blank.")
    const cached = this.cache.get(id)
    const pr = cached?.type === "agentManager.prStatus" ? cached.pr : undefined
    if (!wt || this.branches.get(id) !== wt.branch || !pr) {
      throw new Error(
        m.type === "agentManager.replyComment"
          ? "Review thread not found in this worktree."
          : "Pull request not found in this worktree.",
      )
    }
    if (m.type === "agentManager.mutateComment") return mutateComment(m, pr, wt.path)
    if (!pr.comments?.comments.some((comment) => comment.threadId === threadId))
      throw new Error("Review thread not found in this worktree.")
    return replyComment(threadId, m.body as string, wt.path)
  }

  /** Remove cached status for a deleted worktree. */
  remove(worktreeId: string): void {
    this.cache.delete(worktreeId)
    this.branches.delete(worktreeId)
  }

  reset(): void {
    this.poller.stop()
    this.suggestions.dispose()
    this.reviews = new PRReviewActions(this.actionHost)
    this.suggestions = new PRSuggestionActions(this.actionHost)
    this.cache.clear()
    this.branches.clear()
    this.lastErrorNotified = undefined
  }

  notifyError(err: "gh_missing" | "gh_auth" | "fetch_failed"): void {
    if (this.lastErrorNotified === err) return
    this.lastErrorNotified = err
    this.error(err)
  }

  private error(err: "gh_missing" | "gh_auth" | "fetch_failed"): void {
    const project = this.host.projectId?.()
    this.host.postToWebview({
      type: "agentManager.prError",
      error: err,
      ...(project ? { projectId: project } : undefined),
    })
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
      ...(host.projectId?.() ? { projectId: host.projectId() } : {}),
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
  if (prev && retainPRStatus(prev, bridge["branches"].get(id), branch, pr)) {
    host.log(`PR status: keeping PR #${prev.number} for ${id}, empty result on ${branch}`)
    return
  }
  const merged = pr && prev ? mergePRStatus(prev, pr) : pr
  const msg = {
    type: "agentManager.prStatus",
    worktreeId: id,
    pr: merged,
    ...(host.projectId?.() ? { projectId: host.projectId() } : {}),
  } as AgentManagerOutMessage
  bridge["cache"].set(id, msg)
  if (pr && branch !== undefined) bridge["branches"].set(id, branch)
  if (!pr) bridge["branches"].delete(id)
  bridge["lastErrorNotified"] = undefined
  host.postToWebview(msg)
  host.updateWorktreePR(id, pr?.number, pr?.url, pr?.state)
}
