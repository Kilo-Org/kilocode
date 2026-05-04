import * as vscode from "vscode"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourcePost } from "./types"
import { patchToBeforeAfter } from "./patch-to-before-after"

export type SessionDiffFetch = (params: { sessionID: string; directory?: string }) => Promise<SnapshotFileDiff[]>

export const SESSION_PREFIX = "session:"

export function sessionDescriptor(sessionId: string): DiffSourceDescriptor {
  return {
    id: `${SESSION_PREFIX}${sessionId}`,
    label: "Current session",
    group: "Session",
    capabilities: { revert: false, comments: true },
  }
}

/**
 * Diff for the current session. One-shot fetch;
 * no polling and no SSE. Backend returns `{file, patch, ...}`
 * (SnapshotFileDiff); this source converts each patch to before/after so
 * the webview can render it with the same component used for worktree diffs.
 */
export class SessionDiffSource implements DiffSource {
  readonly descriptor: DiffSourceDescriptor

  constructor(
    private readonly sessionId: string,
    private readonly fetch: SessionDiffFetch,
    private readonly workspaceRoot?: string,
  ) {
    this.descriptor = sessionDescriptor(sessionId)
  }

  async initialFetch(post: DiffSourcePost): Promise<void> {
    post({ type: "loading", loading: true })

    try {
      const raw = await this.fetch({ sessionID: this.sessionId, directory: this.workspaceRoot })
      const diffs: DiffFile[] = raw.map((r) => {
        const { before, after } = patchToBeforeAfter(r.patch)
        return {
          file: r.file,
          before,
          after,
          additions: r.additions,
          deletions: r.deletions,
          status: r.status,
          tracked: true,
          generatedLike: false,
          summarized: r.patch === "",
        }
      })
      post({ type: "diffs", diffs })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      post({ type: "error", message })
    } finally {
      post({ type: "loading", loading: false })
    }
  }

  start(_post: DiffSourcePost): vscode.Disposable {
    return new vscode.Disposable(() => {})
  }

  dispose(): void {}
}
