export interface MercuryRecentSnippet {
  filepath: string
  content: string
}

export interface MercuryEditRequestContext {
  currentFilePath: string
  currentFileContent: string
  cursorLine: number
  cursorCharacter: number
  editableRegionStartLine: number
  editableRegionEndLine: number
  recentlyViewedSnippets: MercuryRecentSnippet[]
  editDiffHistory: string[]
}

export interface MercuryEditSuggestion {
  /** The replacement text for lines [editableRegionStartLine, editableRegionEndLine]. */
  replacement: string
  editableRegionStartLine: number
  editableRegionEndLine: number
  /** Latency in milliseconds from request send to response parse. */
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}
