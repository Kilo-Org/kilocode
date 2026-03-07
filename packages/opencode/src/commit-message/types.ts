export interface CommitMessageRequest {
  /** Workspace/repo path */
  path: string
  /** Optional subset of files to include */
  selectedFiles?: string[]
  /** Previously generated message — when set, the LLM is asked to produce a different one */
  previousMessage?: string
}

export interface CommitMessageResponse {
  /** The generated commit message */
  message: string
}

export interface GitContext {
  /** Current branch name */
  branch: string
  /** Last 5 commit summaries */
  recentCommits: string[]
  /** File changes with status and diff content */
  files: FileChange[]
}

export interface FileChange {
  status: "added" | "modified" | "deleted" | "renamed"
  path: string
  /** Diff content, or placeholder for binary/untracked files */
  diff: string
}
