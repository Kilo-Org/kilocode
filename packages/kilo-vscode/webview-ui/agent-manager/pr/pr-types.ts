// PR sub-types — source of truth for all PR-related types used in the PR panel.
// PRStatus lives in src/types/messages/agent-manager.ts for broad consumption.

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

export interface PRReviewer {
  login: string
  avatar?: string
  state: ReviewerState
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
