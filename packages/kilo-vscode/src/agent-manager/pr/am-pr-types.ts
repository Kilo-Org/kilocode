import type { PRState, PRStatus, ReviewDecision } from "../types"

// Raw shapes returned by `gh pr view --json`

export interface GhAuthor {
  login?: string
  avatarUrl?: string
}
export interface GhReactionGroup {
  content?: string
  reactors?: { totalCount?: number }
  users?: { totalCount?: number }
  viewerHasReacted?: boolean
}
export interface GhComment {
  viewerDidAuthor?: boolean
  viewerCanUpdate?: boolean
  viewerCanDelete?: boolean
  id: string
  author?: GhAuthor
  body?: string
  path?: string
  line?: number | null
  originalLine?: number | null
  url?: string
  createdAt?: string
  diffHunk?: string
  reactionGroups?: GhReactionGroup[]
}
export interface GhThread {
  id?: string
  isResolved?: boolean
  isOutdated?: boolean
  path?: string
  diffSide?: "LEFT" | "RIGHT"
  line?: number | null
  originalLine?: number | null
  startLine?: number | null
  originalStartLine?: number | null
  startDiffSide?: "LEFT" | "RIGHT" | null
  comments?: { nodes?: GhComment[] }
  latest?: { nodes?: GhComment[] }
}
export interface GhReviewRequest {
  requestedReviewer?: GhAuthor
  login?: string
  avatarUrl?: string
}
export interface GhReview {
  author?: GhAuthor
  state?: string
}

export interface GhConversationComment {
  viewerDidAuthor?: boolean
  viewerCanUpdate?: boolean
  viewerCanDelete?: boolean
  id: string
  author?: GhAuthor & { __typename?: string }
  body?: string
  createdAt?: string
  url?: string
  reactionGroups?: GhReactionGroup[]
}

export interface GhReviewWithBody {
  id: string
  author?: GhAuthor & { __typename?: string }
  body?: string
  state?: string
  submittedAt?: string
  url?: string
  reactionGroups?: GhReactionGroup[]
}

export interface PRResult {
  id?: string
  number: number
  baseRefOid?: string
  headRefOid?: string
  title: string
  body: string
  url: string
  state: PRState
  review: ReviewDecision | null
  additions: number
  deletions: number
  files: number
  checks?: PRStatus["checks"]
  reviewers?: PRStatus["reviewers"]
}
