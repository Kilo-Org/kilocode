export interface PanelContext {
  workspaceRoot: string | undefined
  sessionId?: string
  /** Overrides the computed default source on open. */
  initialSourceId?: string
  /** Select a file when the source first loads. */
  initialFile?: string
  /** Render Markdown when the viewer was opened from a Markdown file link. */
  initialMarkdown?: boolean
  /**
   * Hides the source picker header in the diff viewer. Used for panels that
   * open in a fixed view (e.g. a specific turn's diff)
   */
  hidePicker?: boolean
  /** User-picked base branch for the workspace source. Undefined = auto. */
  baseBranchOverride?: string
  /**
   * Explicit directory to diff inside, overriding the workspace root lookup.
   * Agent Manager passes a worktree path so its sources operate in the
   * worktree rather than the main checkout.
   */
  dir?: string
  /**
   * When true, a source whose `dir` resolves to undefined returns an empty
   * diff instead of falling back to the workspace root. Agent Manager sets
   * this so an unresolvable worktree context never silently diffs the main
   * checkout.
   */
  strictDir?: boolean
  /**
   * Explicit base ref for the workspace source, skipping auto-resolution.
   * Agent Manager passes the worktree's recorded parent ref.
   */
  baseBranch?: string
  /** Shared GitOps / log injected by Agent Manager to avoid per-source channels. */
  git?: import("../agent-manager/GitOps").GitOps
  log?: (...args: unknown[]) => void
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

/** Mirrors `WorktreeFileDiff` in webview-ui/src/types/messages/agent-manager.ts. */
export interface DiffFile {
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
