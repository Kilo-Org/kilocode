import * as vscode from "vscode"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../image-preview"
import type { DiffVirtualFile, DiffVirtualProvider } from "../DiffVirtualProvider"
import { normalizeDiffStyle, resolveOpenFileInput } from "./vscode-actions-utils"

export function openExternal(url: unknown): void {
  if (typeof url !== "string") return
  void vscode.env.openExternal(vscode.Uri.parse(url))
}

export function openDiffVirtual(
  provider: DiffVirtualProvider | undefined,
  diff: unknown,
  initialDiffStyle?: unknown,
): void {
  if (!provider || !diff) return
  const d = diff as DiffVirtualFile
  d.initialDiffStyle = normalizeDiffStyle(initialDiffStyle)
  provider.open(d)
}

export function handlePreviewImage(dir: vscode.Uri | undefined, dataUrl: string, filename: string): void {
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

/**
 * Handle openFile request from the webview by opening a file in the VS Code editor.
 * Relative paths resolve against the current session directory supplied by KiloProvider.
 */
export function handleOpenFile(root: string, filePath: string, line?: number, column?: number): void {
  const input = resolveOpenFileInput(filePath)
  const uri =
    input.type === "absolute" ? vscode.Uri.file(input.path) : vscode.Uri.joinPath(vscode.Uri.file(root), input.path)
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
}

export async function getGitRemoteUrl(warn: (message: string, error: unknown) => void): Promise<string | undefined> {
  try {
    const extension = vscode.extensions.getExtension("vscode.git")
    if (!extension) return undefined
    const api = extension.isActive ? extension.exports?.getAPI(1) : (await extension.activate())?.getAPI(1)
    if (!api) return undefined
    const repo = api.repositories?.[0]
    if (!repo) return undefined
    const remote = repo.state?.remotes?.find((r: { name: string }) => r.name === "origin")
    return remote?.fetchUrl ?? remote?.pushUrl
  } catch (error) {
    warn("[Kilo New] KiloProvider: Failed to get git remote URL:", error)
    return undefined
  }
}
