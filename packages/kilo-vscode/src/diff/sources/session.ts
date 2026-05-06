import * as vscode from "vscode"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import type { DiffFile } from "../types"
import { hashFileDiffs } from "../shared/hash"
import { DIFF_POLL_INTERVAL_MS } from "../polling"
import type { DiffSource, DiffSourceDescriptor, DiffSourcePost } from "./types"
import { normalize, text } from "@kilocode/kilo-ui/session-diff"

export type SessionDiffFetch = (params: { sessionID: string; directory?: string }) => Promise<SnapshotFileDiff[]>

export type SnapshotEnabledCheck = (directory?: string) => Promise<boolean>

export const SESSION_PREFIX = "session:"

export function sessionSourceId(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`
}

export function sessionDescriptor(sessionId: string): DiffSourceDescriptor {
  return {
    id: sessionSourceId(sessionId),
    type: "session",
    group: "Session",
    capabilities: { revert: false, comments: true },
  }
}

/**
 * Diff for the current session. Initial fetch + 2.5s polling with hash dedup
 */
export class SessionDiffSource implements DiffSource {
  readonly descriptor: DiffSourceDescriptor

  private lastHash: string | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private disposed = false

  private snapshotsDisabled = false

  constructor(
    private readonly sessionId: string,
    private readonly fetch: SessionDiffFetch,
    private readonly workspaceRoot?: string,
    private readonly checkSnapshotsEnabled?: SnapshotEnabledCheck,
  ) {
    this.descriptor = sessionDescriptor(sessionId)
  }

  async initialFetch(post: DiffSourcePost): Promise<void> {
    post({ type: "loading", loading: true })

    try {
      if (this.checkSnapshotsEnabled) {
        const enabled = await this.checkSnapshotsEnabled(this.workspaceRoot)
        if (this.disposed) return
        if (!enabled) {
          this.snapshotsDisabled = true
          post({ type: "notice", notice: "snapshots-disabled" })
          post({ type: "diffs", diffs: [] })
          return
        }
      }

      const diffs = await this.fetchDiffs()
      if (this.disposed) return
      this.lastHash = hashFileDiffs(diffs as never)
      post({ type: "diffs", diffs })
    } catch (err) {
      if (this.disposed) return
      const message = err instanceof Error ? err.message : String(err)
      post({ type: "error", message })
    } finally {
      if (!this.disposed) post({ type: "loading", loading: false })
    }
  }

  start(post: DiffSourcePost): vscode.Disposable {
    this.stopPolling()
    // Skip polling entirely when snapshots are disabled — nothing to fetch.
    if (this.snapshotsDisabled) return new vscode.Disposable(() => {})
    this.interval = setInterval(() => {
      void this.poll(post)
    }, DIFF_POLL_INTERVAL_MS)

    return new vscode.Disposable(() => this.stopPolling())
  }

  dispose(): void {
    this.disposed = true
    this.stopPolling()
    this.lastHash = undefined
  }

  private async fetchDiffs(): Promise<DiffFile[]> {
    const raw = await this.fetch({ sessionID: this.sessionId, directory: this.workspaceRoot })
    return raw.map((r) => {
      // Empty patch means binary or summarized (>256 KB) — normalize() can't
      // parse it, so short-circuit to empty strings.
      const view = r.patch === "" ? null : normalize(r)
      return {
        file: r.file,
        before: view ? text(view, "deletions") : "",
        after: view ? text(view, "additions") : "",
        additions: r.additions,
        deletions: r.deletions,
        status: r.status,
        tracked: true,
        generatedLike: false,
        summarized: r.patch === "",
      }
    })
  }

  private async poll(post: DiffSourcePost): Promise<void> {
    try {
      const diffs = await this.fetchDiffs()
      if (this.disposed) return
      const hash = hashFileDiffs(diffs as never)
      if (hash === this.lastHash) return
      this.lastHash = hash
      post({ type: "diffs", diffs })
    } catch (err) {
      if (this.disposed) return
      console.log("[Kilo New] SessionDiffSource.poll error", err)
    }
  }

  private stopPolling(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }
}
