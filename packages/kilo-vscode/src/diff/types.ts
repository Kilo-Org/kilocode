export interface PanelContext {
  workspaceRoot: string | undefined
  sessionId?: string
  /** Overrides the computed default source on open. */
  initialSourceId?: string
  /**
   * Hides the source picker header in the diff viewer. Used for panels that
   * open in a fixed view (e.g. a specific turn's diff)
   */
  hidePicker?: boolean
  /** User-picked base branch for the workspace source. Undefined = auto. */
  baseBranchOverride?: string
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
