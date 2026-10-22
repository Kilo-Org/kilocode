// PR types — source of truth for all PR-related types used by the PR panel and
// the extension/webview message boundary.

export type PRState = "open" | "draft" | "merged" | "closed"
export type ReviewDecision = "approved" | "changes_requested" | "pending"
export type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled"
export type AggregateCheckStatus = "success" | "failure" | "pending" | "none"
export const PR_REACTION_CONTENT = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
] as const
export type PRReactionContent = (typeof PR_REACTION_CONTENT)[number]

export interface PRReaction {
  content: PRReactionContent
  count: number
  viewerHasReacted: boolean
}

export interface PRCheck {
  name: string
  status: CheckStatus
  url?: string
  duration?: string
}

export interface PRCommentReply {
  id?: string
  canEdit?: boolean
  canDelete?: boolean
  author: string
  body: string
  avatar?: string
  createdAt?: number
  url?: string
  reactions?: PRReaction[]
}

export interface PRComment {
  canEdit?: boolean
  canDelete?: boolean
  id: string
  threadId: string
  author: string
  avatar?: string
  body: string
  file?: string
  side?: "additions" | "deletions"
  line?: number
  originalLine?: number
  startLine?: number
  unmapped?: boolean
  url?: string
  resolved: boolean
  outdated: boolean
  createdAt?: number
  diffHunk?: string
  preview?: {
    patch: string
    line: number
    side: "additions" | "deletions"
    base: string
    head: string
    top: boolean
    bottom: boolean
  }
  previewUnavailable?: boolean
  after?: string[]
  replies?: PRCommentReply[]
  reactions?: PRReaction[]
}

export type ReviewerState = "approved" | "changes_requested" | "pending" | "commented"

export type PRMergeMethod = "merge" | "squash" | "rebase"
export type PRMergeability = "mergeable" | "conflicting" | "unknown"
export type PRMergeState = "clean" | "behind" | "blocked" | "dirty" | "unstable" | "draft" | "has_hooks" | "unknown"

export interface PRMergeStatus {
  mergeable: PRMergeability
  state: PRMergeState
  auto: PRMergeMethod | null
  methods: PRMergeMethod[]
  method: PRMergeMethod
  autoAllowed: boolean
  canWrite: boolean
}

export interface PRReviewer {
  login: string
  avatar?: string
  state: ReviewerState
}

export interface PRStatus {
  viewerDidAuthor?: boolean
  id?: string
  number: number
  baseRefOid?: string
  headRefOid?: string
  title: string
  body?: string
  author?: string
  createdAt?: string
  url: string
  state: PRState
  review: ReviewDecision | null
  merge?: PRMergeStatus
  checks: {
    status: AggregateCheckStatus
    total: number
    passed: number
    failed: number
    pending: number
    checks: PRCheck[]
  }
  reviewers: PRReviewer[]
  unresolvedThreads?: number
  comments?: {
    total: number
    unresolved: number
    comments: PRComment[]
  }
  conversation?: PRTimelineItem[]
  /** Whether GitHub has timeline items before the loaded window. */
  conversationHasEarlier?: boolean
  additions: number
  deletions: number
  files: number
}

export interface PRConversationComment {
  kind?: "issue" | "review"
  canEdit?: boolean
  canDelete?: boolean
  id: string
  author: string
  avatar?: string
  body: string
  createdAt?: number
  url?: string
  state?: ReviewerState
  isBot?: boolean
  reactions?: PRReaction[]
}

export interface PRCommitItem {
  kind: "commit"
  id: string
  sha: string
  short: string
  message: string
  author: string
  avatar?: string
  createdAt?: number
  url?: string
}

export type PREventKind = "merged" | "closed" | "reopened" | "force_pushed"

export interface PREventItem {
  kind: "event"
  event: PREventKind
  id: string
  actor: string
  avatar?: string
  createdAt?: number
  /** merged: target branch. force_pushed: `before to after` short SHAs. */
  detail?: string
  url?: string
}

/** One entry of the PR conversation: a comment, a commit, or a lifecycle event. */
export type PRTimelineItem = PRConversationComment | PRCommitItem | PREventItem

/** Comments and reviews render as cards; commits and events render as rows. */
export function isConversationComment(item: PRTimelineItem): item is PRConversationComment {
  return item.kind !== "commit" && item.kind !== "event"
}
