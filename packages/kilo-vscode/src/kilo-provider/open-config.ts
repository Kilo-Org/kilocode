import * as path from "path"
import * as vscode from "vscode"
import { content, globalFiles, localFiles, type Entry, type Scope } from "./config-file"
import { text } from "./config-i18n"

export async function openConfig(scope: Scope, root?: string): Promise<void> {
  const lang = vscode.env.language
  const label = text(lang, scope === "global" ? "scopeGlobal" : "scopeLocal")
  if (scope === "local" && !root) {
    void vscode.window.showWarningMessage(text(lang, "noWorkspace"))
    return
  }

  const list = scope === "global" ? globalFiles() : localFiles(root!)
  const picked = await pick(list, label, lang)
  if (!picked?.file) return

  await open(picked.file, label, lang)
}

async function pick(list: Entry[], scope: string, lang: string) {
  const editable = list.filter((item) => !item.virtual)
  if (editable.length === 1) return editable[0]

  const picked = await vscode.window.showQuickPick(
    editable.map((item) => ({
      label: item.recommended && !item.exists ? `$(add) ${item.name}` : `$(json) ${item.name}`,
      description: item.exists ? status(item, lang) : text(lang, "statusCreate"),
      detail: `${text(lang, item.source)} - ${item.file}`,
      item,
    })),
    {
      title: text(lang, "title", { scope }),
      placeHolder: text(lang, "placeholder"),
    },
  )

  return picked?.item
}

function status(item: Entry, lang: string) {
  if (!item.loaded) return text(lang, "statusNotLoaded")
  if (item.legacy) return text(lang, "statusLoadedLegacy")
  return text(lang, "statusLoaded")
}

async function open(file: string, scope: string, lang: string) {
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
    void vscode.window.showErrorMessage(text(lang, "openFailed", { scope, message: msg }))
  }
}
