import * as path from "path"
import * as vscode from "vscode"
import { parseImage } from "../image-preview"

export async function saveImage(dir: string, dataUrl: string, filename: string) {
  const img = parseImage(dataUrl, filename)
  if (!img) return

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(dir, img.name)),
    filters: { Images: [img.ext] },
    saveLabel: "Save",
  })
  if (!uri) return
  await vscode.workspace.fs.writeFile(uri, img.data)
}
