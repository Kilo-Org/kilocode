import * as vscode from "vscode"
import type { KiloConnectionService } from "../../services/cli-backend"
import { GitOps } from "../../agent-manager/GitOps"
import { diffSummary, diffFile } from "../../agent-manager/local-diff"
import type { WorktreeDiffEntry } from "../../agent-manager/types"
import { WorktreeDiffClient, type DiffTarget } from "../shared/client"
import { hashFileDiffs } from "../shared/hash"
import { resolveLocalDiffTarget } from "../shared/target"
import { DIFF_POLL_INTERVAL_MS } from "../polling"
import { appendOutput, getWorkspaceRoot } from "../../review-utils"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourcePost } from "./types"

export const WORKSPACE_SOURCE_ID = "workspace"

export const WORKSPACE_DESCRIPTOR: DiffSourceDescriptor = {
  id: WORKSPACE_SOURCE_ID,
  type: "workspace",
  group: "Git",
  capabilities: { revert: true, comments: true },
}

/**
 * Diffs between the local working tree and the base branch. Polls a summary
 * (one entry per changed file, no content) every {@link DIFF_POLL_INTERVAL_MS},
 * then loads `before`/`after`/`patch` per file on demand via {@link requestFile}.
 *
 * Mirrors the Agent Manager's `WorktreeDiffController` and runs entirely in
 * the extension host (no `kilo serve` round-trip)
 */
export class WorktreeDiffSource implements DiffSource {
  readonly descriptor = WORKSPACE_DESCRIPTOR

  private readonly git: GitOps
  private readonly output: vscode.OutputChannel
  private target: DiffTarget | undefined
  private lastHash: string | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private post: DiffSourcePost | undefined

  constructor(private readonly connection: KiloConnectionService) {
    this.git = new GitOps({ log: (...args) => this.log(...args) })
    this.output = vscode.window.createOutputChannel("Kilo Diff: Workspace")
  }

  async initialFetch(post: DiffSourcePost): Promise<void> {
    this.post = post
    post({ type: "loading", loading: true })

    const target = await this.resolveTarget()
    if (!target) {
      post({ type: "diffs", diffs: [] })
      post({ type: "loading", loading: false })
      return
    }

    this.target = target
    await this.fetchAndPost(target, post, true)
    post({ type: "loading", loading: false })
  }

  start(post: DiffSourcePost): vscode.Disposable {
    this.post = post
    this.stopPolling()
    this.interval = setInterval(() => {
      void this.poll(post)
    }, DIFF_POLL_INTERVAL_MS)

    return new vscode.Disposable(() => this.stopPolling())
  }

  async revertFile(file: string): Promise<{ ok: boolean; message: string }> {
    const target = this.target ?? (await this.resolveTarget())
    if (!target) {
      return { ok: false, message: "Could not resolve diff target" }
    }

    try {
      const client = this.connection.getClient()
      const diff = new WorktreeDiffClient(client, this.git, (...args) => this.log(...args))
      const result = await diff.revertFile(target, file)
      if (result.ok && this.post) void this.poll(this.post)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to revert file:", message)
      return { ok: false, message }
    }
  }

  async requestFile(file: string): Promise<DiffFile | null> {
    if (!file) return null
    const target = this.target ?? (await this.resolveTarget())
    if (!target) return null
    this.target = target

    try {
      const entry = await diffFile(this.git, target.directory, target.baseBranch, file, (...args) => this.log(...args))
      if (!entry) return null
      return toDiffFile(entry)
    } catch (err) {
      this.log("Failed to fetch worktree diff file:", err)
      return null
    }
  }

  dispose(): void {
    this.stopPolling()
    this.git.dispose()
    this.output.dispose()
    this.post = undefined
    this.target = undefined
    this.lastHash = undefined
  }

  private async resolveTarget(): Promise<DiffTarget | undefined> {
    return await resolveLocalDiffTarget(this.git, (...args) => this.log(...args), getWorkspaceRoot())
  }

  private async fetchAndPost(target: DiffTarget, post: DiffSourcePost, force: boolean): Promise<void> {
    try {
      const entries = await diffSummary(this.git, target.directory, target.baseBranch, (...args) => this.log(...args))
      const diffs = entries.map(toDiffFile)
      const hash = hashFileDiffs(diffs as never)
      if (!force && hash === this.lastHash) return
      this.lastHash = hash

      this.log(`Diff: ${diffs.length} file(s)`)
      post({ type: "diffs", diffs })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to fetch diff:", message)
      if (force) post({ type: "error", message })
    }
  }

  private async poll(post: DiffSourcePost): Promise<void> {
    const target = this.target
    if (!target) {
      await this.initialFetch(post)
      return
    }
    await this.fetchAndPost(target, post, false)
  }

  private stopPolling(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }

  private log(...args: unknown[]): void {
    appendOutput(this.output, "WorktreeDiffSource", ...args)
  }
}

/**
 * Project a `WorktreeDiffEntry` from `local-diff.ts` onto the `DiffFile` shape
 * expected by the diff viewer. Drops `patch` (the webview rebuilds before/after
 * for itself) and coerces optional `before`/`after` to empty strings when the
 * entry is summarized.
 */
function toDiffFile(entry: WorktreeDiffEntry): DiffFile {
  return {
    file: entry.file,
    before: entry.before ?? "",
    after: entry.after ?? "",
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: entry.generatedLike,
    summarized: entry.summarized,
    stamp: entry.stamp,
  }
}
