import { createPatch } from "diff"
import * as vscode from "vscode"

const DEFAULT_DEBOUNCE_MS = 1500
const DEFAULT_MAX_DIFFS = 5

type Options = {
  debounceMs?: number
  maxDiffs?: number
  isFileAllowed: (fsPath: string) => Promise<boolean>
}

type Diff = {
  key: string
  patch: string
}

/**
 * Tracks per-file snapshots and emits a workspace-wide chronological stream
 * of range-based unidiffs after a short idle window. Cross-file history is
 * intentional: Mercury uses recent edits from any file to infer user intent.
 *
 * Diffs are produced lazily; the tracker holds the previously-emitted state
 * per file and computes the diff against the current document content when
 * the debounce fires.
 */
export class EditHistoryTracker implements vscode.Disposable {
  private readonly snapshots = new Map<string, string>()
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>()
  private readonly diffs: Diff[] = []
  private readonly subscriptions: vscode.Disposable[] = []

  constructor(private readonly options: Options) {
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

    // Seed snapshots on open so the FIRST edit in a freshly-opened file is
    // captured in the diff history (otherwise the common "open, type, trigger"
    // flow ships an empty edit-history block). Access checks happen before
    // reading text so ignored documents are never retained as edit context.
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme !== "file") return
        void this.seed(doc)
      }),
    )
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === "file") void this.seed(doc)
    }
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== "file") return
        if (event.contentChanges.length === 0) return
        void this.scheduleSnapshotDiff(event.document, debounceMs)
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
  public async flush(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.fsPath
    if (!(await this.allowed(key))) {
      this.reject(key)
      return
    }
    const t = this.pendingTimers.get(key)
    if (t) clearTimeout(t)
    this.pendingTimers.delete(key)
    await this.emitDiffNow(document)
  }

  /** Workspace-wide oldest to newest, matching the Mercury prompt-history convention. */
  public async getRecentDiffs(): Promise<string[]> {
    const kept = (
      await Promise.all(this.diffs.map(async (diff) => ((await this.allowed(diff.key)) ? diff : undefined)))
    ).filter((diff): diff is Diff => diff !== undefined)
    this.diffs.splice(0, this.diffs.length, ...kept)
    return kept.map((diff) => diff.patch)
  }

  public dispose(): void {
    for (const t of this.pendingTimers.values()) clearTimeout(t)
    this.pendingTimers.clear()
    for (const s of this.subscriptions) s.dispose()
    this.subscriptions.length = 0
  }

  private async seed(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.fsPath
    if (this.snapshots.has(key)) return
    if (!(await this.allowed(key))) {
      this.reject(key)
      return
    }
    if (!this.snapshots.has(key)) this.snapshots.set(key, document.getText())
  }

  private async scheduleSnapshotDiff(document: vscode.TextDocument, debounceMs: number): Promise<void> {
    const key = document.uri.fsPath
    if (!(await this.allowed(key))) {
      this.reject(key)
      return
    }
    if (!this.snapshots.has(key)) {
      // Fallback seed for documents we never saw open (e.g. opened before the
      // tracker existed). The triggering change is lost, but subsequent edits
      // produce useful diffs.
      this.snapshots.set(key, document.getText())
      return
    }
    const existing = this.pendingTimers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key)
      void this.emitDiffNow(document)
    }, debounceMs)
    this.pendingTimers.set(key, timer)
  }

  private async emitDiffNow(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.fsPath
    if (!(await this.allowed(key))) {
      this.reject(key)
      return
    }
    const previous = this.snapshots.get(key)
    if (previous === undefined) return
    const current = document.getText()
    if (current === previous) return

    const filename = vscode.workspace.asRelativePath(document.uri, false)
    const patch = createPatch(filename, previous, current, undefined, undefined, { context: 1 })
    // `createPatch` returns "" for identical inputs; guard anyway.
    if (patch && patch.trim().length > 0) {
      this.diffs.push({ key, patch })
      const maxDiffs = this.options.maxDiffs ?? DEFAULT_MAX_DIFFS
      if (this.diffs.length > maxDiffs) this.diffs.shift()
    }
    this.snapshots.set(key, current)
  }

  private async allowed(key: string): Promise<boolean> {
    const allow = this.options.isFileAllowed
    if (!allow) return false
    return allow(key).catch(() => false)
  }

  private reject(key: string): void {
    const timer = this.pendingTimers.get(key)
    if (timer) clearTimeout(timer)
    this.pendingTimers.delete(key)
    this.snapshots.delete(key)
    const kept = this.diffs.filter((diff) => diff.key !== key)
    this.diffs.splice(0, this.diffs.length, ...kept)
  }
}
