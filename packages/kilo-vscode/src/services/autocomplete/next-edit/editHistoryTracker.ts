import { createPatch } from "diff"
import * as vscode from "vscode"

const DEFAULT_DEBOUNCE_MS = 1500
const DEFAULT_MAX_DIFFS = 5

/**
 * Per-file snapshot tracker that emits range-based unidiffs after a short
 * idle window — matching the Mercury docs' guidance: "if a user made multiple
 * modifications in the same area, combine them into a single unidiff rather
 * than many granular diffs."
 *
 * Diffs are produced lazily; the tracker holds the previously-emitted state
 * per file and computes the diff against the current document content when
 * the debounce fires.
 */
export class EditHistoryTracker implements vscode.Disposable {
  private readonly snapshots = new Map<string, string>()
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>()
  private readonly diffs: string[] = []
  private readonly subscriptions: vscode.Disposable[] = []

  constructor(
    private readonly options: { debounceMs?: number; maxDiffs?: number } = {},
  ) {
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== "file") return
        if (event.contentChanges.length === 0) return
        this.scheduleSnapshotDiff(event.document, debounceMs)
      }),
    )
    this.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.fsPath
        const t = this.pendingTimers.get(key)
        if (t) clearTimeout(t)
        this.pendingTimers.delete(key)
        this.snapshots.delete(key)
      }),
    )
  }

  /**
   * Force the pending diff (if any) for `document` to be emitted now. Call
   * this immediately before building a request so the freshest user edit
   * makes it into the prompt.
   */
  public flush(document: vscode.TextDocument): void {
    const key = document.uri.fsPath
    const t = this.pendingTimers.get(key)
    if (t) clearTimeout(t)
    this.pendingTimers.delete(key)
    this.emitDiffNow(document)
  }

  /** Oldest → newest, matching the Mercury prompt-history convention. */
  public getRecentDiffs(): string[] {
    return [...this.diffs]
  }

  public dispose(): void {
    for (const t of this.pendingTimers.values()) clearTimeout(t)
    this.pendingTimers.clear()
    for (const s of this.subscriptions) s.dispose()
    this.subscriptions.length = 0
  }

  private scheduleSnapshotDiff(document: vscode.TextDocument, debounceMs: number): void {
    const key = document.uri.fsPath
    if (!this.snapshots.has(key)) {
      // Seed the snapshot lazily — the first change is lost (we never saw
      // the pre-edit state) but every subsequent edit window produces a
      // useful diff.
      this.snapshots.set(key, document.getText())
      return
    }
    const existing = this.pendingTimers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key)
      this.emitDiffNow(document)
    }, debounceMs)
    this.pendingTimers.set(key, timer)
  }

  private emitDiffNow(document: vscode.TextDocument): void {
    const key = document.uri.fsPath
    const previous = this.snapshots.get(key)
    if (previous === undefined) return
    const current = document.getText()
    if (current === previous) return

    const filename = vscode.workspace.asRelativePath(document.uri, false)
    const patch = createPatch(filename, previous, current, undefined, undefined, { context: 1 })
    // `createPatch` returns "" for identical inputs; guard anyway.
    if (patch && patch.trim().length > 0) {
      this.diffs.push(patch)
      const maxDiffs = this.options.maxDiffs ?? DEFAULT_MAX_DIFFS
      if (this.diffs.length > maxDiffs) this.diffs.shift()
    }
    this.snapshots.set(key, current)
  }
}
