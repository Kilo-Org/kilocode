export interface PanelContext {
  workspaceRoot: string | undefined
  sessionId?: string
  /** Overrides the computed default source on open. */
  initialSourceId?: string
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
