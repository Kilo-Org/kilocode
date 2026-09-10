import * as path from "path"
import * as vscode from "vscode"
import { content, globalFiles, localFiles, type Entry, type Scope, type Source } from "./config-file"

interface Labels extends Record<Source, string> {
  scope: string
  statusLoaded: string
  statusLoadedLegacy: string
  statusNotLoaded: string
  statusCreate: string
  title: string
  placeholder: string
  noWorkspace: string
  openFailed: string
}

export async function openConfig(scope: Scope, labels: Labels, root?: string): Promise<void> {
  if (scope === "local" && !root) {
    void vscode.window.showWarningMessage(labels.noWorkspace)
    return
  }

  const list = scope === "global" ? globalFiles() : localFiles(root!)
  const picked = await pick(list, labels)
  if (!picked?.file) return

  await open(picked.file, labels)
}

async function pick(list: Entry[], labels: Labels) {
  const editable = list.filter((item) => !item.virtual)
  if (editable.length === 1) return editable[0]

  const picked = await vscode.window.showQuickPick(
    editable.map((item) => ({
      label: item.recommended && !item.exists ? `$(add) ${item.name}` : `$(json) ${item.name}`,
      description: item.exists ? status(item, labels) : labels.statusCreate,
      detail: `${labels[item.source]} - ${item.file}`,
      item,
    })),
    {
      title: labels.title,
      placeHolder: labels.placeholder,
    },
  )

  return picked?.item
}

function status(item: Entry, labels: Labels) {
  if (!item.loaded) return labels.statusNotLoaded
  if (item.legacy) return labels.statusLoadedLegacy
  return labels.statusLoaded
}

async function open(file: string, labels: Labels) {
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
    void vscode.window.showErrorMessage(labels.openFailed.replace("{{message}}", () => msg))
  }
}
