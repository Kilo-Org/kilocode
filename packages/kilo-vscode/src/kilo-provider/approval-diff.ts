import * as vscode from "vscode"
import { applyPatch, parsePatch } from "diff"
import type { DiffVirtualFile, DiffVirtualProvider } from "../DiffVirtualProvider"
import { isAbsolutePath } from "../path-utils"

/**
 * Auto-open the full-screen diff viewer when an edit permission ask arrives,
 * instead of requiring a click on the expand button in the approval dock.
 *
 * Two viewer modes:
 * - "kilo"    — the Kilo diff panel (same as the expand button in the dock)
 * - "vscode"  — a native VS Code diff editor over virtual before/after documents
 */

export type ApprovalDiffViewer = "kilo" | "vscode"

export type PermissionAsk = {
  id: string
  sessionID: string
  toolName: string
  metadata: Record<string, unknown>
}

type PermissionDiff = {
  file: string
  patch?: string
  additions: number
  deletions: number
  files?: PermissionDiff[]
}

const CONFIG_ROOT = "kilo-code.new"
const ENABLED_KEY = "approvalDiff.autoOpen"
const VIEWER_KEY = "approvalDiff.viewer"
/** Virtual document scheme for the "after" side of native diffs. */
const SCHEME = "kilo-code-new-approval-diff"

export function approvalDiffEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_ROOT).get<boolean>(ENABLED_KEY, false)
}

export function approvalDiffViewer(): ApprovalDiffViewer {
  const viewer = vscode.workspace.getConfiguration(CONFIG_ROOT).get<string>(VIEWER_KEY, "kilo")
  return viewer === "vscode" ? "vscode" : "kilo"
}

/**
 * Extract the file diffs a permission ask carries, mirroring the webview's
 * `permissionDiffs()` (args.filediff → args.files → args.diff) so both paths
 * agree on what is diffable.
 */
export function permissionAskDiffs(ask: PermissionAsk): PermissionDiff[] {
  const meta = ask.metadata
  const direct = clean(meta.filediff)
  if (direct) return [direct]
  const files = meta.files
  if (Array.isArray(files)) {
    return files.flatMap((item) => {
      const diff = file(item)
      return diff ? [diff] : []
    })
  }
  const patch = text(meta.diff)
  if (!patch) return []
  const name = text(meta.filepath) ?? "patch"
  return [{ file: name, patch, additions: 0, deletions: 0 }]
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" ? value : 0
}

function clean(diff: unknown): PermissionDiff | undefined {
  if (!diff || typeof diff !== "object") return
  const item = diff as Record<string, unknown>
  const file = text(item.file)
  if (!file) return
  return {
    file,
    ...(text(item.patch) !== undefined ? { patch: text(item.patch) } : {}),
    additions: num(item.additions),
    deletions: num(item.deletions),
  }
}

function file(item: unknown): PermissionDiff | undefined {
  if (!item || typeof item !== "object") return
  const entry = item as Record<string, unknown>
  const name = text(entry.relativePath) ?? text(entry.filePath)
  if (!name) return
  return {
    file: name,
    ...(text(entry.patch) !== undefined ? { patch: text(entry.patch) } : {}),
    additions: num(entry.additions),
    deletions: num(entry.deletions),
  }
}

/**
 * Opens the diff for a permission ask when the user enabled auto-open.
 * Fires once per ask id; returns true when a viewer was opened.
 */
export function openApprovalDiff(
  ask: PermissionAsk,
  opts: {
    diff?: DiffVirtualProvider
    directory: string
    seen: Set<string>
    enabled?: () => boolean
    viewer?: () => ApprovalDiffViewer
  },
): boolean {
  const enabled = opts.enabled ?? approvalDiffEnabled
  const resolve = opts.viewer ?? approvalDiffViewer
  if (!enabled()) return false
  // Only edit-style asks carry diffs; bash/external_directory asks never do.
  if (ask.toolName !== "edit") return false
  if (opts.seen.has(ask.id)) return false
  const diffs = permissionAskDiffs(ask)
  const openable = diffs.filter((diff) => !!diff.patch)
  if (openable.length === 0) return false
  opts.seen.add(ask.id)
  const first = openable[0]!
  const diff = openable.length > 1 ? virtual({ ...first, files: openable }) : virtual(first)
  if (resolve() === "vscode") {
    void openNativeDiff(ask.id, diff, opts.directory)
    return true
  }
  if (!opts.diff) return false
  diff.askID = ask.id
  opts.diff.open(diff)
  opened.set(ask.id, { kind: "kilo", panel: opts.diff })
  return true
}

/** What a resolved ask opened, so closeApprovalDiff can close exactly that. */
const opened = new Map<string, { kind: "vscode"; uri: vscode.Uri } | { kind: "kilo"; panel: DiffVirtualProvider }>()

/**
 * Close the viewer that was auto-opened for a permission ask, once the user
 * approved or rejected it. Asks that never auto-opened are ignored.
 */
export function closeApprovalDiff(askId: string): void {
  const entry = opened.get(askId)
  if (!entry) return
  opened.delete(askId)
  if (entry.kind === "vscode") {
    const uri = entry.uri
    const same = (candidate: vscode.Uri) =>
      candidate.scheme === uri.scheme && candidate.path === uri.path && candidate.query === uri.query
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input
        if (input instanceof vscode.TabInputTextDiff && same(input.modified)) {
          void vscode.window.tabGroups.close(tab)
        }
      }
    }
    return
  }
  entry.panel.closeIfCurrent(askId)
}

function virtual(perm: PermissionDiff): DiffVirtualFile {
  return { ...perm, initialDiffStyle: "unified" }
}

/**
 * Resolve a diff's file path against the session directory. The backend can
 * send either a workspace-relative path or an absolute path (Windows or
 * POSIX), so absolute ones must not be re-joined onto the base — that would
 * produce doubled garbage like `dir\C:\dir\file`.
 */
function resolve(directory: string, file: string): vscode.Uri {
  if (isAbsolutePath(file)) return vscode.Uri.file(file)
  return vscode.Uri.joinPath(vscode.Uri.file(directory), file)
}

/**
 * Reconstructs full before/after contents by applying the patch to the current
 * file on disk. Falls back to hunk-only reconstruction when the file cannot be
 * read or the patch does not apply cleanly.
 */
async function contents(diff: PermissionDiff, directory: string): Promise<{ before: string; after: string }> {
  const uri = resolve(directory, diff.file)
  const current = await vscode.workspace.fs.readFile(uri).then(
    (bytes) => Buffer.from(bytes).toString("utf8"),
    () => undefined,
  )
  const patch = diff.patch ?? ""
  if (current === undefined) {
    // File does not exist yet (create) or is unreadable — render hunks only.
    const parsed = parsePatch(patch)[0]
    const before: string[] = []
    const after: string[] = []
    for (const hunk of parsed?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.startsWith("-")) before.push(line.slice(1))
        else if (line.startsWith("+")) after.push(line.slice(1))
        else {
          before.push(line.slice(1))
          after.push(line.slice(1))
        }
      }
    }
    return { before: before.join("\n"), after: after.join("\n") }
  }
  const applied = applyPatch(current, patch)
  if (typeof applied === "string") return { before: current, after: applied }
  // Patch did not apply (file drifted since the ask) — show hunks against empty.
  return { before: current, after: current }
}

/**
 * Opens a native VS Code diff editor. The "before" side is the file on disk
 * (pre-approval, unchanged); the "after" side is a virtual document holding the
 * patched content, so no scratch files are written to the workspace.
 */
async function openNativeDiff(askId: string, diff: PermissionDiff, directory: string): Promise<void> {
  const { after } = await contents(diff, directory)
  const file = vscode.Uri.file(diff.file)
  // The ask id in the query keys both the content cache and the ask → tab
  // match in closeApprovalDiff.
  const afterUri = vscode.Uri.from({
    scheme: SCHEME,
    path: file.path,
    query: encodeURIComponent(askId),
  })
  // Cache before opening: VS Code resolves the virtual document synchronously
  // when the diff editor loads it.
  virtualContents.set(afterUri.toString(), after)
  opened.set(askId, { kind: "vscode", uri: afterUri })
  void vscode.commands.executeCommand(
    "vscode.diff",
    resolve(directory, diff.file),
    afterUri,
    `${diff.file.split(/[\\/]/).pop() ?? diff.file} (Kilo proposed edit)`,
  )
}

/** Cached virtual-document contents keyed by URI string. */
const virtualContents = new Map<string, string>()

export const approvalDiffContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return virtualContents.get(uri.toString()) ?? ""
  },
}

export function approvalDiffScheme(): string {
  return SCHEME
}
