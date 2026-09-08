import { createHash } from "node:crypto"
import { serialize } from "../../util/serialize"
import type {
  CheckStatus,
  PRCheck,
  PRComment,
  PRCommentReply,
  PRConversationComment,
  PRReaction,
  PRReactionContent,
  PRReviewer,
  PRStatus,
  ReviewerState,
} from "../types"
import { PR_REACTION_CONTENT } from "../../../webview-ui/agent-manager/pr/pr-types"
import type {
  PRResult,
  GhAuthor,
  GhComment,
  GhReactionGroup,
  GhThread,
  GhReviewRequest,
  GhReview,
  GhConversationComment,
  GhReviewWithBody,
} from "./am-pr-types"

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
    id: data.id,
    number: data.number,
    ...(typeof data.baseRefOid === "string" ? { baseRefOid: data.baseRefOid } : {}),
    ...(typeof data.headRefOid === "string" ? { headRefOid: data.headRefOid } : {}),
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
  const latest = new Map<string, { item: unknown; index: number; started: number }>()
  items.forEach((item, index) => {
    const check = item as {
      name?: string
      context?: string
      workflowName?: string
      event?: string
      startedAt?: string
      state?: string
      status?: string
      conclusion?: string | null
    }
    const key = check.context
      ? `status:${check.context}`
      : `run:${check.name ?? "Unknown check"}:${check.workflowName ?? ""}:${check.event ?? ""}`
    const state = check.conclusion ?? check.state ?? check.status
    const active = ["PENDING", "QUEUED", "IN_PROGRESS", "REQUESTED", "WAITING", "EXPECTED"].includes(state ?? "")
    const date = check.startedAt ? new Date(check.startedAt).getTime() : Number.NaN
    const started = Number.isFinite(date) ? date : active ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
    const current = latest.get(key)
    if (!current || started >= current.started) latest.set(key, { item, index, started })
  })
  const values = [...latest.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ item }) => {
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
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return "failure"
    case "PENDING":
    case "QUEUED":
    case "IN_PROGRESS":
    case "REQUESTED":
    case "WAITING":
    case "EXPECTED":
      return "pending"
    case "SKIPPED":
      return "skipped"
    case "CANCELLED":
    case "STALE":
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

const REACTION_CONTENT = new Set<string>(PR_REACTION_CONTENT)

export function parseReactions(groups?: GhReactionGroup[]): PRReaction[] {
  return (groups ?? []).flatMap((group) => {
    const content = group.content
    const count = group.reactors?.totalCount ?? group.users?.totalCount
    if (
      !content ||
      !REACTION_CONTENT.has(content) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      return []
    }
    return [{ content: content as PRReactionContent, count, viewerHasReacted: group.viewerHasReacted === true }]
  })
}

function location(
  thread: GhThread,
  first: GhComment,
): Pick<PRComment, "file" | "side" | "line" | "originalLine" | "startLine"> {
  const originalLine = thread.originalLine ?? first.originalLine ?? undefined
  const line = thread.line ?? first.line ?? originalLine
  const side = thread.diffSide === "LEFT" ? "deletions" : thread.diffSide === "RIGHT" ? "additions" : undefined
  const startLine = side && thread.startDiffSide === thread.diffSide ? (thread.startLine ?? undefined) : undefined
  return {
    file: thread.path ?? first.path,
    ...(side ? { side } : {}),
    ...(line === undefined ? {} : { line }),
    ...(originalLine === undefined ? {} : { originalLine }),
    ...(startLine === undefined ? {} : { startLine }),
  }
}

function parseReply(node: GhComment): PRCommentReply {
  const reactions = parseReactions(node.reactionGroups)
  return {
    id: node.id,
    canEdit: node.viewerDidAuthor === true && node.viewerCanUpdate === true,
    canDelete: node.viewerDidAuthor === true && node.viewerCanDelete === true,
    author: node.author?.login ?? "unknown",
    body: node.body ?? "",
    ...(node.author?.avatarUrl ? { avatar: node.author.avatarUrl } : {}),
    ...(node.createdAt ? { createdAt: new Date(node.createdAt).getTime() } : {}),
    ...(node.url ? { url: node.url } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  }
}

function parseReplies(nodes: GhComment[]): PRComment["replies"] {
  const list = nodes.slice(1).map(parseReply)
  return list.length > 0 ? list : undefined
}

function parseThread(thread: GhThread): PRComment | undefined {
  // Keep the root and include recent replies beyond the first page.
  const original = thread.comments?.nodes ?? []
  const ids = new Set(original.map((node) => node.id))
  const nodes = [...original, ...(thread.latest?.nodes ?? []).filter((node) => !ids.has(node.id))]
  const first = nodes.at(0)
  if (!first) return undefined
  const current = thread.line === undefined ? first.line : thread.line
  const reactions = parseReactions(first.reactionGroups)
  return {
    id: first.id,
    canEdit: first.viewerDidAuthor === true && first.viewerCanUpdate === true,
    canDelete: first.viewerDidAuthor === true && first.viewerCanDelete === true,
    threadId: thread.id ?? first.id,
    author: first.author?.login ?? "unknown",
    avatar: first.author?.avatarUrl,
    body: first.body ?? "",
    ...location(thread, first),
    url: first.url,
    resolved: thread.isResolved ?? false,
    outdated: thread.isOutdated ?? false,
    createdAt: first.createdAt ? new Date(first.createdAt).getTime() : undefined,
    diffHunk: first.diffHunk,
    ...(typeof current === "number" ? {} : { unmapped: true, previewUnavailable: true }),
    replies: parseReplies(nodes),
    ...(reactions.length > 0 ? { reactions } : {}),
  }
}

export function parseComments(threads: GhThread[]): PRComment[] {
  const items: PRComment[] = []
  for (const thread of threads) {
    const item = parseThread(thread)
    if (item) items.push(item)
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

function bot(author?: GhAuthor & { __typename?: string }): boolean {
  if (!author?.login) return false
  return author.__typename === "Bot" || author.login.endsWith("[bot]") || author.login === "kilo-code-bot"
}

function commentItem(node: GhConversationComment): PRConversationComment | null {
  if (!node.id || !node.body?.trim()) return null
  const reactions = parseReactions(node.reactionGroups)
  return {
    id: node.id,
    kind: "issue",
    canEdit: node.viewerDidAuthor === true && node.viewerCanUpdate === true,
    canDelete: node.viewerDidAuthor === true && node.viewerCanDelete === true,
    author: node.author?.login ?? "unknown",
    avatar: node.author?.avatarUrl,
    body: node.body,
    createdAt: node.createdAt ? new Date(node.createdAt).getTime() : undefined,
    url: node.url,
    isBot: bot(node.author) || undefined,
    ...(reactions.length > 0 ? { reactions } : {}),
  }
}

function reviewItem(node: GhReviewWithBody): PRConversationComment | null {
  if (!node.id || !node.body?.trim()) return null
  const reactions = parseReactions(node.reactionGroups)
  return {
    id: node.id,
    kind: "review",
    canEdit: false,
    canDelete: false,
    author: node.author?.login ?? "unknown",
    avatar: node.author?.avatarUrl,
    body: node.body,
    createdAt: node.submittedAt ? new Date(node.submittedAt).getTime() : undefined,
    url: node.url,
    state: REVIEWER_STATE[node.state ?? ""],
    isBot: bot(node.author) || undefined,
    ...(reactions.length > 0 ? { reactions } : {}),
  }
}

export function parseConversation(
  comments: GhConversationComment[],
  reviews: GhReviewWithBody[],
): PRConversationComment[] {
  const items: PRConversationComment[] = []
  for (const node of comments) {
    const item = commentItem(node)
    if (item) items.push(item)
  }
  for (const node of reviews) {
    const item = reviewItem(node)
    if (item) items.push(item)
  }
  items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return items
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
  if (!prev || prev.number !== next.number || prev.url !== next.url) return next
  const current = prev.baseRefOid === next.baseRefOid && prev.headRefOid === next.headRefOid ? prev : undefined
  return {
    ...next,
    viewerDidAuthor: next.viewerDidAuthor ?? prev.viewerDidAuthor,
    id: next.id ?? prev.id,
    comments: next.comments ?? current?.comments,
    unresolvedThreads: next.unresolvedThreads ?? next.comments?.unresolved ?? current?.unresolvedThreads,
    conversation: next.conversation ?? prev.conversation,
  }
}

export function signature(pr: PRStatus): string {
  return serialize([
    pr.viewerDidAuthor,
    pr.id,
    pr.url,
    pr.number,
    pr.baseRefOid ?? null,
    pr.headRefOid ?? null,
    pr.title,
    pr.state,
    pr.review,
    [
      pr.checks.status,
      pr.checks.passed,
      pr.checks.total,
      pr.checks.checks.map((check) => [check.name, check.status, check.url ?? "", check.duration ?? ""]),
    ],
    pr.reviewers.map((r) => [r.login, r.state]),
    pr.body ?? "",
    [
      pr.comments?.total ?? null,
      pr.comments?.unresolved ?? null,
      pr.unresolvedThreads ?? null,
      commentsSig(pr.comments?.comments),
    ],
    pr.conversation?.map((c) => [
      c.id,
      c.author,
      c.body,
      c.state ?? "",
      c.isBot ? 1 : 0,
      c.reactions?.map((reaction) => [reaction.content, reaction.count, reaction.viewerHasReacted]) ?? [],
      c.kind,
      c.canEdit,
      c.canDelete,
    ]) ?? [],
  ])
}

export function retainPRStatus(
  prev: PRStatus | undefined,
  prevBranch: string | undefined,
  branch: string | undefined,
  next: PRStatus | null,
): boolean {
  return !next && prev !== undefined && branch !== undefined && branch === prevBranch
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
