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
