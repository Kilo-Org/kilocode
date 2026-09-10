import * as path from "path"
import * as vscode from "vscode"
import { parseImage } from "../image-preview"

type ImageMessage = {
  dataUrl: string
  filename: string
}

export function saveImage(dir: string, msg: ImageMessage) {
  void save(dir, msg).catch((err) => console.error("[Kilo New] KiloProvider: Failed to save image:", err))
}

async function save(dir: string, msg: ImageMessage) {
  const img = parseImage(msg.dataUrl, msg.filename)
  if (!img) return undefined

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(dir, img.name)),
    filters: { Images: [img.ext] },
    saveLabel: "Save",
  })
  if (!uri) return undefined
  return vscode.workspace.fs.writeFile(uri, img.data)
}
