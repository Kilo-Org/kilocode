import type * as vscode from "vscode"
import type { DiffFile } from "../types"

export interface DiffSourceCapabilities {
  revert: boolean
  comments: boolean
}

export interface DiffSourceDescriptor {
  /** Unique within a panel context. E.g. "workspace", "session:<sessionId>". */
  id: string
  label: string
  group: "Workspace" | "Session" | "Git"
  /** kilo-ui icon name. */
  icon?: string
  capabilities: DiffSourceCapabilities
}

export type DiffSourceMessage =
  | { type: "diffs"; diffs: DiffFile[] }
  | { type: "loading"; loading: boolean }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }

export type DiffSourcePost = (msg: DiffSourceMessage) => void

/**
 * A DiffSource produces file diffs for a given context (local workspace,
 * session changes, a turn, a git ref...). The DiffPanelManager owns one
 * active source at a time and swaps between them on user request.
 */
export interface DiffSource {
  readonly descriptor: DiffSourceDescriptor

  initialFetch(post: DiffSourcePost): Promise<void>

  /** Start change detection (polling, SSE, watcher...). Dispose to stop. */
  start?(post: DiffSourcePost): vscode.Disposable

  revertFile?(file: string): Promise<{ ok: boolean; message: string }>

  dispose(): void
}
