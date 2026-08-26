import type { DiffFile } from "../types"

export interface DiffSourceCapabilities {
  revert: boolean
  comments: boolean
}

/**
 * Closed enum of diff source kinds. Drives i18n key composition for types
 * that appear in the picker: `diffViewer.source.<type>.label` and
 * `diffViewer.source.<type>.tooltip`. Types that are only ever shown in
 * hide-picker mode (e.g. `turn`) don't need matching i18n entries because
 * `DiffPickerHeader` never renders them.
 */
export type DiffSourceType = "workspace" | "session" | "turn" | "staged" | "unstaged"

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

export interface DiffSourceFetch {
  diffs: DiffFile[]
  notice?: DiffSourceNotice
  /**
   * When true the controller stops polling the source after this fetch.
   * Used for terminal states like snapshots-disabled, where repeat fetches
   * can't surface new data.
   */
  stopPolling?: boolean
}

/**
 * A DiffSource is a plain data producer for a given context (local workspace,
 * session changes, a turn, a git ref...). The SourceController owns one active
 * source at a time, calls `fetch` on activation and on a polling tick, and
 * forwards the results to the webview.
 */
export interface DiffSource {
  readonly descriptor: DiffSourceDescriptor

  fetch(): Promise<DiffSourceFetch>

  /**
   * Lazy detail load for a single file, for sources that emit summarized
   * entries (no `before`/`after` content) so the webview can fetch full
   * content on demand.
   */
  fetchFile?(file: string): Promise<DiffFile | null>

  revert?(file: string): Promise<{ ok: boolean; message: string }>

  dispose?(): void
}
