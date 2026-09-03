import type { PRState, PRStatus, ReviewDecision } from "../types"

// Raw shapes returned by `gh pr view --json`

export interface GhAuthor {
  login?: string
  avatarUrl?: string
}
export interface GhComment {
  id: string
  author?: GhAuthor
  body?: string
  path?: string
  line?: number
  originalLine?: number
  url?: string
  createdAt?: string
  diffHunk?: string
}
export interface GhThread {
  id?: string
  isResolved?: boolean
  isOutdated?: boolean
  comments?: { nodes?: GhComment[] }
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

export interface PRResult {
  number: number
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
