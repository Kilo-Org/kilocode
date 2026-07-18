import * as vscode from "vscode"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../image-preview"
import { escapeGlob, isAbsolutePath } from "../path-utils"
import { validateFiles } from "./file-links"
import type { DiffVirtualFile, DiffVirtualProvider } from "../DiffVirtualProvider"

type EditorOpenMessage = {
  type?: string
  filePath?: string
  line?: number
  column?: number
  content?: string
  language?: string
  sessionID?: string
}

function openExternal(url: unknown): void {
  if (typeof url !== "string") return
  void vscode.env.openExternal(vscode.Uri.parse(url))
}

function openDiffVirtual(provider: DiffVirtualProvider | undefined, diff: unknown, initialDiffStyle?: unknown): void {
  if (!provider || !diff) return
  const file = diff as DiffVirtualFile
  file.initialDiffStyle = initialDiffStyle === "split" ? "split" : "unified"
  provider.open(file)
}

function previewImage(dir: vscode.Uri | undefined, dataUrl: string, filename: string): void {
  if (!dir) return

  const img = parseImage(dataUrl, filename)
  if (!img) return

  const root = vscode.Uri.joinPath(dir, getPreviewDir())
  const uri = vscode.Uri.joinPath(dir, buildPreviewPath(img.name, Date.now()))
  const clean = () =>
    vscode.workspace.fs.readDirectory(root).then(
      (items) => {
        const stale = trimEntries(items.map(([name]) => ({ path: name })))
        return Promise.all(
          stale.map((name) =>
            Promise.resolve(vscode.workspace.fs.delete(vscode.Uri.joinPath(root, name), { recursive: true })).then(
              undefined,
              (err: unknown) => {
                console.warn("[Kilo New] KiloProvider: Failed to delete stale preview:", err)
              },
            ),
          ),
        )
      },
      () => [],
    )
  const open = () =>
    vscode.commands
      .executeCommand(...getPreviewCommand(uri))
      .then(undefined, () => vscode.commands.executeCommand("vscode.open", uri))

  void vscode.workspace.fs
    .createDirectory(root)
    .then(() => vscode.workspace.fs.writeFile(uri, img.data))
    .then(() => clean())
    .then(open, (err) => console.error("[Kilo New] KiloProvider: Failed to preview image:", err))
}

export function handleEditorAction(
  message: EditorOpenMessage & {
    url?: unknown
    diff?: unknown
    initialDiffStyle?: unknown
    dataUrl?: string
    filename?: string
    id?: string
    paths?: string[]
  },
  opts: {
    dir: (sessionID?: string) => string
    diff?: DiffVirtualProvider
    storage?: vscode.Uri
    post?: (msg: unknown) => void
  },
): boolean {
  if (message.type === "openFile") {
    if (message.filePath) openFile(opts.dir(), message.filePath, message.line, message.column)
    return true
  }
  if (message.type === "openContent") {
    if (message.content) openContent(message.content, message.language)
    return true
  }
  if (message.type === "validateFiles") {
    const id = message.id
    const paths = message.paths
    if (id && paths && opts.post) {
      const post = opts.post
      // Resolve the directory from the session id the webview validated the
      // candidates against, not whatever session happens to be current when
      // this message is processed (avoids validating against the wrong
      // worktree during an Agent Manager session switch).
      validateFiles(opts.dir(message.sessionID), paths).then(
        (existing) => post({ type: "validateFilesResult", id, existing }),
        (err) => console.error("[Kilo New] KiloProvider: validateFiles failed:", err),
      )
    }
    return true
  }
  if (message.type === "openExternal") {
    openExternal(message.url)
    return true
  }
  if (message.type === "openDiffVirtual") {
    openDiffVirtual(opts.diff, message.diff, message.initialDiffStyle)
    return true
  }
  if (message.type === "previewImage") {
    if (message.dataUrl && message.filename) previewImage(opts.storage, message.dataUrl, message.filename)
    return true
  }
  return false
}

function openContent(content: string, language?: string): void {
  vscode.workspace.openTextDocument({ content, language: language || "log" }).then(
    (doc) => vscode.window.showTextDocument(doc, { preview: true }),
    (err) => console.error("[Kilo New] KiloProvider: Failed to open content:", err),
  )
}

function show(uri: vscode.Uri, line?: number, column?: number): void {
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      const options: vscode.TextDocumentShowOptions = { preview: true }
      if (line !== undefined && line > 0) {
        const col = column !== undefined && column > 0 ? column - 1 : 0
        const pos = new vscode.Position(line - 1, col)
        options.selection = new vscode.Range(pos, pos)
      }
      vscode.window
        .showTextDocument(doc, options)
        .then(undefined, (err) => console.error("[Kilo New] KiloProvider: Failed to show document:", uri.fsPath, err))
    },
    (err) => console.error("[Kilo New] KiloProvider: Failed to open file:", uri.fsPath, err),
  )
}

/**
 * Fallback when the exact path does not exist: search the session directory by
 * filename. Opens the file directly on a single match, prompts on multiple,
 * warns on none. The search is scoped to `dir` (the active session's directory)
 * via a RelativePattern so it can't cross into another worktree/branch.
 */
function findFallback(dir: string, filePath: string, line?: number, column?: number): void {
  const name = filePath.split(/[\\/]/).pop() || filePath
  // VS Code globs don't honor backslash escapes, so bracket-escape metacharacters
  // (e.g. `[id].tsx`) instead — otherwise such names never match.
  const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), `**/${escapeGlob(name)}`)
  Promise.resolve(vscode.workspace.findFiles(pattern, "**/node_modules/**", 5)).then(
    (matches) => {
      if (matches.length === 1) {
        show(matches[0], line, column)
        return
      }
      if (matches.length > 1) {
        const items = matches.map((m) => ({ label: vscode.workspace.asRelativePath(m), uri: m }))
        vscode.window.showQuickPick(items, { placeHolder: `Multiple matches for "${name}"` }).then(
          (pick) => {
            if (pick) show(pick.uri, line, column)
          },
          (err) => console.error("[Kilo New] KiloProvider: showQuickPick failed:", err),
        )
        return
      }
      vscode.window.showWarningMessage(`File not found: ${filePath}`)
    },
    (err: unknown) => console.error("[Kilo New] KiloProvider: findFiles failed:", err),
  )
}

function openFile(dir: string, filePath: string, line?: number, column?: number): void {
  const uri = isAbsolutePath(filePath) ? vscode.Uri.file(filePath) : vscode.Uri.joinPath(vscode.Uri.file(dir), filePath)
  vscode.workspace.fs.stat(uri).then(
    (stat) => {
      if (stat.type & vscode.FileType.Directory) {
        vscode.commands.executeCommand("revealInExplorer", uri)
        return
      }
      show(uri, line, column)
    },
    () => findFallback(dir, filePath, line, column),
  )
}
