import type * as vscode from "vscode"
import type { DiffFile } from "../types"

export interface DiffSourceCapabilities {
  revert: boolean
  comments: boolean
}

/**
 * Closed enum of diff source kinds. Drives i18n key composition:
 * `diffViewer.source.<type>.label` and `diffViewer.source.<type>.tooltip`.
 */
export type DiffSourceType = "workspace" | "session"

export interface DiffSourceDescriptor {
  /** Unique within a panel context. E.g. "workspace", "session:<sessionId>". */
  id: string
  type: DiffSourceType
  group: "Session" | "Git"
  /** kilo-ui icon name. */
  icon?: string
  capabilities: DiffSourceCapabilities
}

/**
 * Well-known notice kinds that a source can surface to the diff viewer.
 * The webview maps these to translated messages.
 */
export type DiffSourceNotice = "snapshots-disabled"

export type DiffSourceMessage =
  | { type: "diffs"; diffs: DiffFile[] }
  | { type: "loading"; loading: boolean }
  | { type: "error"; message: string }
  | { type: "notice"; notice: DiffSourceNotice | undefined }

export type DiffSourcePost = (msg: DiffSourceMessage) => void

/**
 * A DiffSource produces file diffs for a given context (local workspace,
 * session changes, a turn, a git ref...). The SourceController owns one
 * active source at a time and swaps between them on user request.
 */
export interface DiffSource {
  readonly descriptor: DiffSourceDescriptor

  initialFetch(post: DiffSourcePost): Promise<void>

  /** Start change detection (polling, SSE, watcher...). Dispose to stop. */
  start?(post: DiffSourcePost): vscode.Disposable

  revertFile?(file: string): Promise<{ ok: boolean; message: string }>

  /**
   * Lazy detail load for a single file, for sources that emit summarized entries
   * (no `before`/`after` content) so the webview can fetch
   * full content on demand.
   */
  requestFile?(file: string): Promise<DiffFile | null>

  dispose(): void
}
