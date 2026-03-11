import * as path from "path"
import * as vscode from "vscode"
import { inspect } from "util"
import type { FileDiff } from "@kilocode/sdk/v2/client"
import { GitOps } from "./agent-manager/GitOps"

function checksum(content: string): string | undefined {
  if (!content) return undefined
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function sampledChecksum(content: string, limit = 500_000): string | undefined {
  if (!content) return undefined
  if (content.length <= limit) return checksum(content)

  const size = 4096
  const points = [
    0,
    Math.floor(content.length * 0.25),
    Math.floor(content.length * 0.5),
    Math.floor(content.length * 0.75),
    content.length - size,
  ]
  const hashes = points
    .map((point) => {
      const start = Math.max(0, Math.min(content.length - size, point - Math.floor(size / 2)))
      return checksum(content.slice(start, start + size)) ?? ""
    })
    .join(":")
  return `${content.length}:${hashes}`
}

export function appendOutput(channel: vscode.OutputChannel, prefix: string, ...args: unknown[]): void {
  const msg = args
    .map((item) => (typeof item === "string" ? item : inspect(item, { breakLength: Infinity, depth: 4 })))
    .join(" ")
  channel.appendLine(`[${prefix}] ${msg}`)
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) return folders[0].uri.fsPath
  return undefined
}

export async function resolveLocalDiffTarget(
  gitOps: GitOps,
  log: (...args: unknown[]) => void,
): Promise<{ directory: string; baseBranch: string } | undefined> {
  const root = getWorkspaceRoot()
  if (!root) {
    log("Local diff: no workspace root")
    return
  }

  const branch = await gitOps.currentBranch(root)
  if (!branch || branch === "HEAD") {
    log("Local diff: detached HEAD or no branch")
    return
  }

  const tracking = await gitOps.resolveTrackingBranch(root, branch)
  const fallback = tracking ? undefined : await gitOps.resolveDefaultBranch(root, branch)
  const base = tracking ?? fallback ?? "HEAD"

  log(`Local diff: branch=${branch} tracking=${tracking ?? "none"} default=${fallback ?? "none"} base=${base}`)

  return { directory: root, baseBranch: base }
}

// kilocode_change - include sampled before/after content fingerprints so the
// hash stays cheap for large files but still changes when the diff text changes.
export function hashFileDiffs(diffs: FileDiff[]): string {
  return diffs
    .map((diff) => {
      const before = sampledChecksum(diff.before) ?? ""
      const after = sampledChecksum(diff.after) ?? ""
      return `${diff.file}:${diff.status}:${diff.additions}:${diff.deletions}:${diff.binary ? 1 : 0}:${before}:${after}`
    })
    .join("|")
}

export function openFileInEditor(
  filePath: string,
  line?: number,
  column?: number,
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
  prefix = "Kilo",
): void {
  const uri = vscode.Uri.file(filePath)
  const target = Math.max(1, Math.floor(line ?? 1))
  const col = column !== undefined && column > 0 ? column - 1 : 0
  const pos = new vscode.Position(target - 1, col)
  const selection = new vscode.Range(pos, pos)

  vscode.workspace.openTextDocument(uri).then(
    (doc) => vscode.window.showTextDocument(doc, { viewColumn, preview: true, selection }),
    (err) => console.error(`[Kilo New] ${prefix}: Failed to open file:`, uri.fsPath, err),
  )
}

export function openWorkspaceRelativeFile(relativePath: string, line?: number, column?: number): void {
  const root = getWorkspaceRoot()
  if (!root) return
  const resolved = path.resolve(root, relativePath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return
  openFileInEditor(resolved, line, column, vscode.ViewColumn.Beside, "DiffViewerProvider")
}
