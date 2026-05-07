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
}

/** Mirrors `WorktreeFileDiff` in webview-ui/src/types/messages/agent-manager.ts. */
export interface DiffFile {
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
