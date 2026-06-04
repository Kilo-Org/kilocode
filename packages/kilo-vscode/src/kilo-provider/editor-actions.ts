import * as vscode from "vscode"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../image-preview"
import { isAbsolutePath } from "../path-utils"
import type { DiffVirtualFile, DiffVirtualProvider } from "../DiffVirtualProvider"

type EditorOpenMessage = {
  type?: string
  filePath?: string
  line?: number
  column?: number
  content?: string
  language?: string
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
  },
  opts: {
    dir: () => string
    diff?: DiffVirtualProvider
    storage?: vscode.Uri
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

function openFile(dir: string, filePath: string, line?: number, column?: number): void {
  const uri = isAbsolutePath(filePath) ? vscode.Uri.file(filePath) : vscode.Uri.joinPath(vscode.Uri.file(dir), filePath)
  vscode.workspace.fs.stat(uri).then(
    (stat) => {
      if (stat.type & vscode.FileType.Directory) {
        vscode.commands.executeCommand("revealInExplorer", uri)
        return
      }
      vscode.workspace.openTextDocument(uri).then(
        (doc) => {
          const options: vscode.TextDocumentShowOptions = { preview: true }
          if (line !== undefined && line > 0) {
            const col = column !== undefined && column > 0 ? column - 1 : 0
            const pos = new vscode.Position(line - 1, col)
            options.selection = new vscode.Range(pos, pos)
          }
          vscode.window.showTextDocument(doc, options)
        },
        (err) => console.error("[Kilo New] KiloProvider: Failed to open file:", uri.fsPath, err),
      )
    },
    (err) => console.error("[Kilo New] KiloProvider: Path does not exist:", uri.fsPath, err),
  )
}
