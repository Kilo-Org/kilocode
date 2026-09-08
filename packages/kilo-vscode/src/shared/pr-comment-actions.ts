export interface PRTarget {
  projectId?: string
  worktreeId: string
  prNumber: number
  prUrl: string
}

export interface PRFile {
  path: string
  previousPath?: string
  status: string
  patch?: string
}

export interface PRDiffSnapshot {
  id: string
  head: string
  files: PRFile[]
}

export interface PRSuggestionPreview {
  token: string
  path: string
  patch: string
}

type Request = PRTarget & { requestId: string }
type Result = Request & { success: boolean; error?: string }

export type PRReviewRequest =
  | (Request & { type: "agentManager.loadPRFiles" })
  | (Request & {
      type: "agentManager.createReviewComment"
      snapshotId: string
      path: string
      side: "LEFT" | "RIGHT"
      startLine: number
      endLine: number
      body: string
    })
  | (Request & {
      type: "agentManager.submitPRReview"
      snapshotId: string
      head: string
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
      body: string
    })
  | (Request & { type: "agentManager.previewPRSuggestion"; commentId: string; suggestion: number })
  | (Request & { type: "agentManager.applyPRSuggestion"; token: string })

export type PRReviewResult =
  | (Result & { type: "agentManager.loadPRFilesResult"; snapshot?: PRDiffSnapshot })
  | (Result & { type: "agentManager.createReviewCommentResult" })
  | (Result & { type: "agentManager.submitPRReviewResult" })
  | (Result & { type: "agentManager.previewPRSuggestionResult"; preview?: PRSuggestionPreview })
  | (Result & { type: "agentManager.applyPRSuggestionResult" })

type Route = { projectId?: string; worktreeId: string; requestId: string }
type Outcome = Route & { success: boolean; error?: string }

export type PRCommentRequest =
  | PRReviewRequest
  | (Route & { type: "agentManager.replyComment"; threadId: string; body: string })
  | (Request & {
      type: "agentManager.mutateComment"
      action: "create" | "edit" | "delete"
      commentId?: string
      body?: string
    })

export type PRCommentResult =
  | PRReviewResult
  | (Outcome & { type: "agentManager.replyCommentResult"; threadId: string })
  | (Outcome & { type: "agentManager.mutateCommentResult" })
