import type { PRMergeResult, PRReviewResult } from "../../shared/pr-comment-actions"
import type { PRMergeMethod, PRStatus } from "../types"

export interface PRReviewContext {
  pr: PRStatus
  directory: string
  worktreeId: string
  projectId?: string
  branch: string
  remote?: string
}

export interface PRReviewHost {
  context(message: Record<string, unknown>): PRReviewContext
  post(message: PRReviewResult | PRMergeResult): void
  refresh(context: PRReviewContext, settle?: boolean): void
  dirtyFiles(): string[]
  conflicts?: (context: PRReviewContext, base: string, head: string) => Promise<string[]>
  getPRMergeMethod?: (repo: string) => PRMergeMethod | undefined
  savePRMergeMethod?: (repo: string, method: PRMergeMethod) => Promise<void>
}
