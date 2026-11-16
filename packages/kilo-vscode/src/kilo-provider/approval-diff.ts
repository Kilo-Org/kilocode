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
 * Fires once per ask id (globally — several providers can see one ask);
 * returns true when a viewer was opened.
 */
export function openApprovalDiff(
  ask: PermissionAsk,
  opts: {
    diff?: DiffVirtualProvider
    directory: string
    enabled?: () => boolean
    viewer?: () => ApprovalDiffViewer
  },
): boolean {
  const enabled = opts.enabled ?? approvalDiffEnabled
  const resolve = opts.viewer ?? approvalDiffViewer
  if (!enabled()) return false
  // Only edit-style asks carry diffs; bash/external_directory asks never do.
  if (ask.toolName !== "edit") return false
  if (seen.has(ask.id)) return false
  const diffs = permissionAskDiffs(ask)
  const openable = diffs.filter((diff) => !!diff.patch)
  if (openable.length === 0) return false
  seen.add(ask.id)
  if (resolve() === "vscode") {
    void openNativeDiff(ask.id, openable, opts.directory)
    return true
  }
  if (!opts.diff) return false
  const first = openable[0]!
  const diff = openable.length > 1 ? virtual({ ...first, files: openable }) : virtual(first)
  diff.askID = ask.id
  opts.diff.open(diff)
  opened.set(ask.id, { kind: "kilo", panel: opts.diff })
  return true
}

/** Ask ids already auto-opened; module-level because one ask reaches several providers. */
const seen = new Set<string>()

/** What a resolved ask opened, so closeApprovalDiff can close exactly that. */
const opened = new Map<string, { kind: "vscode"; uris?: vscode.Uri[] } | { kind: "kilo"; panel: DiffVirtualProvider }>()

/**
 * Close the viewer that was auto-opened for a permission ask, once the user
 * approved or rejected it. Asks that never auto-opened are ignored.
 */
export function closeApprovalDiff(askId: string): void {
  const entry = opened.get(askId)
  if (!entry) return
  opened.delete(askId)
  seen.delete(askId)
  if (entry.kind === "vscode") {
    release(entry)
    return
  }
  entry.panel.closeIfCurrent(askId)
}

/** Evict the cached virtual contents for the entry's URIs and close any tabs showing them. */
function release(entry: { uris?: vscode.Uri[] }): void {
  for (const uri of entry.uris ?? []) {
    virtualContents.delete(uri.toString())
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
  }
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
  const parsed = parsePatch(patch)[0]
  const applied = current === undefined ? false : applyPatch(current, patch)
  if (typeof applied !== "string") {
    // File does not exist yet (create), is unreadable, or drifted since the
    // ask — render the hunks only instead of an empty diff.
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
  return { before: current as string, after: applied }
}

/**
 * Opens a native VS Code diff editor per file of the ask. The "before" side is
 * the file on disk (pre-approval, unchanged); the "after" side is a virtual
 * document holding the patched content, so no scratch files are written to the
 * workspace. The ask is reserved in `opened` before any await so a reply that
 * races the async content read still finds and closes the viewer; the uri is
 * filled in once contents are cached (VS Code resolves the virtual document
 * when the diff editor loads it).
 */
async function openNativeDiff(askId: string, files: PermissionDiff[], directory: string): Promise<void> {
  // The stored object itself is the mutable entry: reserved synchronously
  // here, its uris filled in by show() once contents are cached. If show()
  // rejects, the reservation is rolled back so the ask isn't stuck in the
  // maps with no viewer and no way to clean up.
  const entry: { kind: "vscode"; uris?: vscode.Uri[] } = { kind: "vscode" }
  opened.set(askId, entry)
  show(askId, files, directory, entry).catch(() => {
    if (opened.get(askId) === entry) {
      opened.delete(askId)
      seen.delete(askId)
      release(entry)
    }
  })
}

async function show(askId: string, files: PermissionDiff[], directory: string, entry: { uris?: vscode.Uri[] }) {
  const uris: vscode.Uri[] = []
  const read = await Promise.all(files.map((f) => contents(f, directory)))
  files.forEach((f, i) => uris.push(cache(askId, f, read[i]!.after)))
  entry.uris = uris
  if (!opened.has(askId)) {
    // The ask was replied to while contents were loading — evict and stop.
    for (const uri of uris) virtualContents.delete(uri.toString())
    return
  }
  for (const [i, f] of files.entries()) {
    // Awaited (not fire-and-forget) so a failed open rejects show() and the
    // reservation is rolled back by openNativeDiff's catch; re-checked after
    // each open so a reply that lands mid-loop stops the remaining files
    // instead of opening them against evicted contents.
    if (opened.get(askId) !== entry) return
    await vscode.commands.executeCommand(
      "vscode.diff",
      resolve(directory, f.file),
      uris[i]!,
      `${f.file.split(/[\\/]/).pop() ?? f.file} (Kilo proposed edit)`,
    )
  }
}

/** Build the virtual "after" URI for one file and cache its contents under it. */
function cache(askId: string, diff: PermissionDiff, after: string): vscode.Uri {
  const file = vscode.Uri.file(diff.file)
  // The ask id in the query keys both the content cache and the ask → tab
  // match in closeApprovalDiff.
  const uri = vscode.Uri.from({
    scheme: SCHEME,
    path: file.path,
    query: encodeURIComponent(askId),
  })
  virtualContents.set(uri.toString(), after)
  return uri
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
