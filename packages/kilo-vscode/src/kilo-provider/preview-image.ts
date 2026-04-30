import * as vscode from "vscode"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../image-preview"

export function handlePreviewImage(context: vscode.ExtensionContext | undefined, dataUrl: string, filename: string): void {
  const dir = context?.globalStorageUri
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
