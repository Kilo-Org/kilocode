import { commands, Uri, workspace } from "vscode"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "./image-preview"

/**
 * Opens a webview image in a VS Code editor tab. The image preview editor needs a file, so the image is written to a
 * preview folder in extension storage first; the folder keeps only the newest previews.
 */
export async function previewImage(storage: Uri, msg: { dataUrl: string; filename: string }) {
  const img = parseImage(msg.dataUrl, msg.filename)
  if (!img) return
  const root = Uri.joinPath(storage, getPreviewDir())
  const uri = Uri.joinPath(storage, buildPreviewPath(img.name, Date.now()))
  await workspace.fs.createDirectory(root)
  await workspace.fs.writeFile(uri, img.data)
  await clean(root)
  // The built-in image preview may be disabled; the default editor for the file is the fallback.
  await commands.executeCommand(...getPreviewCommand(uri)).then(undefined, () => commands.executeCommand("vscode.open", uri))
}

async function clean(root: Uri) {
  const items = await workspace.fs.readDirectory(root).then(undefined, () => [])
  const stale = trimEntries(items.map(([name]) => ({ path: name })))
  await Promise.all(
    stale.map((name) => Promise.resolve(workspace.fs.delete(Uri.joinPath(root, name))).then(undefined, () => undefined)),
  )
}
