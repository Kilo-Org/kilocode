import type { PRState, ReviewDecision } from "./types"

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
  url?: string
  createdAt?: string
}
export interface GhThread {
  isResolved?: boolean
  comments?: { nodes?: GhComment[] }
}
export interface GhReviewRequest {
  requestedReviewer?: GhAuthor
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
}
