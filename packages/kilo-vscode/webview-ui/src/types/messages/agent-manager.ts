export type WorktreeErrorCode = "git_not_found" | "not_git_repo" | "lfs_missing"

export interface BaseUpdateRequest {
  type: "agentManager.updateFromBase"
  projectId?: string
  worktreeId: string
  sessionId?: string
}

export interface TerminalFont {
  fontFamily: string
  fontSize: number
}

/** Where the terminal button / Focus Terminal shortcut opens a terminal. */
export type TerminalDestination = "vscode" | "agentManager"

/** Where a terminal lives: main tab strip or right-side inspector panel. */
export type TerminalPlacement = "tab" | "side"

// Agent Manager worktree state types (mirrored from WorktreeStateManager)
export interface WorktreeState {
  id: string
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). */
  remote?: string
  createdAt: string
  /** Shared identifier for worktrees created together via multi-version mode. */
  groupId?: string
  /** User-provided display name for the worktree. */
  label?: string
  /** Cached PR number for instant badge display on reload. */
  prNumber?: number
  /** Cached PR URL for instant badge display on reload. */
  prUrl?: string
  /** Cached PR state for correct badge color on reload (open/merged/closed/draft). */
  prState?: string
  /** Section this worktree belongs to, or undefined for ungrouped. */
  sectionId?: string
}

export interface SectionState {
  id: string
  name: string
  /** Color label (e.g. "Red", "Blue") or null for default. */
  color: string | null
  order: number
  collapsed: boolean
}

// ---------------------------------------------------------------------------
// PR status types — sub-types live in agent-manager/pr/pr-types.ts
// ---------------------------------------------------------------------------

import type {
  PRState,
  ReviewDecision,
  AggregateCheckStatus,
  PRCheck,
  PRComment,
  PRReviewer,
  PRConversationComment,
} from "../../../agent-manager/pr/pr-types"
export type {
  PRState,
  ReviewDecision,
  CheckStatus,
  AggregateCheckStatus,
  PRCheck,
  PRComment,
  PRCommentReply,
  PRReviewer,
  PRConversationComment,
} from "../../../agent-manager/pr/pr-types"

export interface PRStatus {
  number: number
  title: string
  body?: string
  url: string
  state: PRState
  review: ReviewDecision | null
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
  conversation?: PRConversationComment[]
  additions: number
  deletions: number
  files: number
}

export type RunState = "idle" | "running" | "stopping"

export interface RunStatus {
  worktreeId: string
  state: RunState
  exitCode?: number
  signal?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface ManagedSessionState {
  id: string
  worktreeId: string | null
  createdAt: string
}

export interface BranchInfo {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
  isCheckedOut?: boolean
}

export type DiffImageError = "too-large" | "unreadable"

export interface DiffImageSide {
  mime: string
  bytes: number
  data?: string
  error?: DiffImageError
}

export interface DiffImage {
  before?: DiffImageSide
  after?: DiffImageSide
}

// Shared FileDiff shape (matches Snapshot.FileDiff from CLI backend)
export interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  /** Hunk-bounded unified patch used by Pierre to avoid re-diffing full files. */
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
  kind?: "image"
  image?: DiffImage
}

export type AgentManagerApplyWorktreeDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export interface AgentManagerApplyWorktreeDiffConflict {
  file?: string
  reason: string
}

// Per-worktree git stats: diff additions/deletions and ahead/behind counts
export interface WorktreeGitStats {
  worktreeId: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

// Per-local-workspace git stats: branch name, diff additions/deletions, ahead/behind counts
export interface LocalGitStats {
  branch: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

export type {
  ReviewCommentData as ReviewComment,
  ReviewCommentEntry,
  PRReviewCommentData,
} from "../../../../src/shared/review-comments"

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in src/agent-manager/constants.ts.
 */
export const MAX_MULTI_VERSIONS = 4

// Per-version model allocation for multi-model comparison mode
export interface ModelAllocation {
  providerID: string
  modelID: string
  count: number
  variant?: string
}

export type ContinueInWorktreeStatus =
  | "capturing"
  | "creating"
  | "setup"
  | "transferring"
  | "forking"
  | "done"
  | "error"
