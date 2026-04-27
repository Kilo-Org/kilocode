import * as path from "path"
import * as vscode from "vscode"
import { content, globalFiles, localFiles, type Entry, type Scope } from "./config-file"

export async function openConfig(scope: Scope, root?: string): Promise<void> {
  if (scope === "local" && !root) {
    void vscode.window.showWarningMessage("Open a workspace folder to edit the local Kilo config file.")
    return
  }

  const list = scope === "global" ? globalFiles() : localFiles(root!)
  const picked = await pick(scope, list)
  if (!picked?.file) return

  await open(scope, picked.file)
}

async function pick(scope: Scope, list: Entry[]) {
  const editable = list.filter((item) => !item.virtual)
  if (editable.length === 1) return editable[0]

  const picked = await vscode.window.showQuickPick(
    editable.map((item) => ({
      label: item.recommended && !item.exists ? `$(add) ${item.name}` : `$(json) ${item.name}`,
      description: item.exists ? status(item) : "not found - create this file",
      detail: `${item.source} - ${item.file}`,
      item,
    })),
    {
      title: `Open ${scope} Kilo config file`,
      placeHolder: "Config files are merged in order; files marked loaded currently affect settings.",
    },
  )

  return picked?.item
}

function status(item: Entry) {
  if (!item.loaded) return "not loaded"
  if (item.legacy) return "loaded legacy config"
  return "loaded"
}

async function open(scope: Scope, file: string) {
  const uri = vscode.Uri.file(file)
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)))
    const exists = await vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    )
    if (!exists) await vscode.workspace.fs.writeFile(uri, Buffer.from(content()))
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, { preview: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[Kilo New] Failed to open config file:", file, err)
    void vscode.window.showErrorMessage(`Failed to open ${scope} Kilo config file: ${msg}`)
  }
}
