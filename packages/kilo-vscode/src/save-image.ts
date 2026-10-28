// Ported from v1 `src/kilo-provider/save-image.ts`: Save on a rendered mermaid diagram asks for a path and writes the file.
import path from "node:path"
import { Uri, window, workspace } from "vscode"
import { parseImage } from "./image-preview"

export function saveImage(dir: string, msg: { dataUrl: string; filename: string }) {
  void save(dir, msg).catch((err) => console.error("[Kilo] Failed to save image:", err))
}

async function save(dir: string, msg: { dataUrl: string; filename: string }) {
  const img = parseImage(msg.dataUrl, msg.filename)
  if (!img) return undefined

  const uri = await window.showSaveDialog({
    defaultUri: Uri.file(path.join(dir, img.name)),
    filters: { Images: [img.ext] },
    saveLabel: "Save",
  })
  if (!uri) return undefined
  return workspace.fs.writeFile(uri, img.data)
}
