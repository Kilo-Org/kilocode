// PR sub-types — source of truth for all PR-related types used in the PR panel.
// PRStatus lives in src/types/messages/agent-manager.ts for broad consumption.

export type PRState = "open" | "draft" | "merged" | "closed"
export type ReviewDecision = "approved" | "changes_requested" | "pending"
export type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled"
export type AggregateCheckStatus = "success" | "failure" | "pending" | "none"

export interface PRCheck {
  name: string
  status: CheckStatus
  url?: string
  duration?: string
}

export interface PRCommentReply {
  author: string
  body: string
}

export interface PRComment {
  id: string
  threadId: string
  author: string
  avatar?: string
  body: string
  file?: string
  line?: number
  url?: string
  resolved: boolean
  outdated: boolean
  createdAt?: number
  diffHunk?: string
  /** Lines after the commented line, read from the worktree: a hunk has none. */
  after?: string[]
  replies?: PRCommentReply[]
}

export type ReviewerState = "approved" | "changes_requested" | "pending" | "commented"

export interface PRReviewer {
  login: string
  avatar?: string
  state: ReviewerState
}
