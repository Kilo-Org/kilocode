export type WorktreeErrorCode = "git_not_found" | "not_git_repo" | "lfs_missing"

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
// PR status types (mirrored from extension types.ts)
// ---------------------------------------------------------------------------

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

export interface PRComment {
  id: string
  author: string
  avatar?: string
  body: string
  file?: string
  line?: number
  url?: string
  resolved: boolean
  createdAt?: number
}

export interface PRStatus {
  number: number
  title: string
  url: string
  state: PRState
  review: ReviewDecision | null
  checks: {
    status: AggregateCheckStatus
    total: number
    passed: number
    failed: number
    pending: number
    items: PRCheck[]
  }
  comments?: {
    total: number
    unresolved: number
    items: PRComment[]
  }
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

// Agent Manager Import tab: external worktrees (extension → webview)
export interface ExternalWorktreeInfo {
  path: string
  branch: string
}

// Shared FileDiff shape (matches Snapshot.FileDiff from CLI backend)
export interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
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

export interface ReviewComment {
  id: string
  file: string
  side: "additions" | "deletions"
  line: number
  comment: string
  selectedText: string
}

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
}

export type ContinueInWorktreeStatus =
  | "capturing"
  | "creating"
  | "setup"
  | "transferring"
  | "forking"
  | "done"
  | "error"
