import type { PRReviewResult } from "../../shared/pr-comment-actions"
import type { PRStatus } from "../types"

export interface PRReviewContext {
  pr: PRStatus
  directory: string
  worktreeId: string
  projectId?: string
  branch: string
}

export interface PRReviewHost {
  context(message: Record<string, unknown>): PRReviewContext
  post(message: PRReviewResult): void
  refresh(context: PRReviewContext): void
  dirtyFiles(): string[]
}
