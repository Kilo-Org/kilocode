import type { CheckStatus, PRComment, PRReviewer, ReviewerState } from "../types"
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
  return {
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
  const secs = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)
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
    const first = thread.comments?.nodes?.[0]
    if (!first) continue
    items.push({
      id: first.id,
      threadId: thread.id ?? first.id,
      author: first.author?.login ?? "unknown",
      avatar: first.author?.avatarUrl,
      body: first.body ?? "",
      file: first.path,
      line: first.line,
      url: first.url,
      resolved: thread.isResolved ?? false,
      createdAt: first.createdAt ? new Date(first.createdAt).getTime() : undefined,
      diffHunk: first.diffHunk,
    })
  }
  return items
}

export function parseReviewers(requests: GhReviewRequest[], reviews: GhReview[]): PRReviewer[] {
  const map = new Map<string, PRReviewer>()
  for (const node of requests) {
    const user = node.requestedReviewer
    if (!user?.login) continue
    map.set(user.login, { login: user.login, avatar: user.avatarUrl, state: "pending" })
  }
  for (const node of reviews) {
    const login = node.author?.login
    if (!login) continue
    const state = REVIEWER_STATE[node.state ?? ""] ?? "pending"
    if (!map.has(login) || state !== "commented") {
      map.set(login, { login, avatar: node.author?.avatarUrl, state })
    }
  }
  return [...map.values()]
}
