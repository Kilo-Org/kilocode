import { createHash } from "node:crypto"
import type { CheckStatus, PRCheck, PRComment, PRReviewer, PRStatus, ReviewerState } from "../types"
import type { PRResult, GhThread, GhReviewRequest, GhReview } from "./am-pr-types"

export function parsePRResult(json: string): PRResult | null {
  const data = JSON.parse(json)
  if (!data.number) return null
  const state = data.isDraft ? "draft" : (data.state?.toLowerCase() ?? "open")
  const decision = data.reviewDecision as string | undefined
  const review =
    decision === "APPROVED"
      ? "approved"
      : decision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : decision === "REVIEW_REQUIRED"
          ? "pending"
          : null
  const result: PRResult = {
    number: data.number,
    title: data.title ?? "",
    body: data.body ?? "",
    url: data.url ?? "",
    state,
    review,
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
    files: data.changedFiles ?? 0,
  }
  if (Array.isArray(data.statusCheckRollup)) result.checks = checks(data.statusCheckRollup)
  if (Array.isArray(data.reviewRequests) && Array.isArray(data.reviews)) {
    result.reviewers = parseReviewers(data.reviewRequests as GhReviewRequest[], data.reviews as GhReview[])
  }
  return result
}

function checks(items: unknown[]): PRStatus["checks"] {
  const values = items.map((item): PRCheck => {
    const check = item as {
      name?: string
      context?: string
      state?: string
      status?: string
      conclusion?: string | null
      link?: string
      detailsUrl?: string
      targetUrl?: string
      startedAt?: string
      completedAt?: string
    }
    return {
      name: check.name ?? check.context ?? "Unknown check",
      status: checkStatus(check.conclusion ?? check.state ?? check.status ?? "PENDING"),
      url: check.detailsUrl ?? check.targetUrl ?? check.link,
      duration: formatCheckDuration(check.startedAt, check.completedAt),
    }
  })
  return summarize(values)
}

export function summarize(checks: PRCheck[]): PRStatus["checks"] {
  const total = checks.filter((item) => item.status !== "skipped").length
  const passed = checks.filter((item) => item.status === "success").length
  const failed = checks.filter((item) => item.status === "failure" || item.status === "cancelled").length
  const pending = checks.filter((item) => item.status === "pending").length
  const broken = checks.some((item) => item.status === "failure")
  const status =
    total === 0 ? "none" : broken ? "failure" : pending > 0 ? "pending" : failed > 0 ? "failure" : "success"
  return { status, total, passed, failed, pending, checks }
}

export function checkStatus(state: string): CheckStatus {
  switch (state.toUpperCase()) {
    case "SUCCESS":
    case "NEUTRAL":
      return "success"
    case "FAILURE":
    case "ERROR":
    case "ACTION_REQUIRED":
      return "failure"
    case "PENDING":
    case "QUEUED":
    case "IN_PROGRESS":
    case "REQUESTED":
    case "WAITING":
      return "pending"
    case "SKIPPED":
      return "skipped"
    case "CANCELLED":
    case "TIMED_OUT":
    case "STALE":
    case "STARTUP_FAILURE":
      return "cancelled"
    default:
      return "pending"
  }
}

export function formatCheckDuration(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  const secs = Math.round((end - start) / 1000)
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
}

const REVIEWER_STATE: Record<string, ReviewerState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
}

export function parseComments(threads: GhThread[]): PRComment[] {
  const items: PRComment[] = []
  for (const thread of threads) {
    const nodes = thread.comments?.nodes ?? []
    const first = nodes[0]
    if (!first) continue
    const replies = nodes.slice(1).map((node) => ({ author: node.author?.login ?? "unknown", body: node.body ?? "" }))
    items.push({
      id: first.id,
      threadId: thread.id ?? first.id,
      author: first.author?.login ?? "unknown",
      avatar: first.author?.avatarUrl,
      body: first.body ?? "",
      file: first.path,
      // An outdated thread has no current line, so fall back to the line it was written against.
      line: first.line ?? first.originalLine,
      url: first.url,
      resolved: thread.isResolved ?? false,
      outdated: thread.isOutdated ?? false,
      createdAt: first.createdAt ? new Date(first.createdAt).getTime() : undefined,
      diffHunk: first.diffHunk,
      replies: replies.length > 0 ? replies : undefined,
    })
  }
  return items
}

export function parseReviewers(requests: GhReviewRequest[], reviews: GhReview[]): PRReviewer[] {
  const map = new Map<string, PRReviewer>()
  for (const node of requests) {
    const user = node.requestedReviewer ?? node
    if (!user?.login) continue
    map.set(user.login, { login: user.login, avatar: user.avatarUrl, state: "pending" })
  }
  for (const node of reviews) {
    const login = node.author?.login
    const state = REVIEWER_STATE[node.state ?? ""]
    if (!login || !state) continue
    if (!map.has(login) || state !== "commented") {
      map.set(login, { login, avatar: node.author?.avatarUrl, state })
    }
  }
  return [...map.values()]
}

/**
 * Short, user-facing reason from a failed `gh` invocation. The raw message
 * repeats the whole command line, which is useless inside a comment card.
 */
export function ghErrorReason(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Command failed"))
  const last = [...lines].reverse().find((line) => !line.startsWith("query") && !line.startsWith("mutation"))
  return (last ?? message.trim()).replace(/^gh:\s*/, "").slice(0, 200)
}

/**
 * Carry review threads across a status that has none. Only the selected worktree
 * fetches comments, and that fetch can fail, so a plain replace would collapse
 * the open comment list in the panel while the user is reading it.
 */
export function mergePRStatus(prev: PRStatus | undefined, next: PRStatus): PRStatus {
  if (next.comments || !prev?.comments) return next
  if (prev.number !== next.number) return next
  return { ...next, comments: prev.comments }
}

/**
 * Signature of the comment threads, for poll deduplication. Thread and
 * unresolved counts alone hide edits and new replies, which the panel renders.
 */
export function commentsSig(comments?: PRComment[]): string {
  if (!comments?.length) return ""
  return createHash("sha256")
    .update(JSON.stringify(comments ?? []))
    .digest("hex")
}
