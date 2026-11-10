// Shortcut labels for the webview prompt hints, on v2 prompt actions. The formatting and user
// keybindings.json merge live in `keybinding-format.ts`; this module only reads the VS Code context.
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import { parseJsonc, resolvePromptKeybindings, userKeybindingFiles, type Binding } from "./keybinding-format"

function readKeybindings(file: string): unknown {
  try {
    return parseJsonc(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

/** Format the prompt-action keybindings for the webview, with the user's keybindings.json applied. */
export function promptKeybindings(context: vscode.ExtensionContext): Record<string, string> {
  const mac = process.platform === "darwin"
  const defaults: Binding[] = context.extension.packageJSON?.contributes?.keybindings ?? []
  const user = userKeybindingFiles(context.globalStorageUri.fsPath)
    .map(readKeybindings)
    .find((value) => value !== undefined)
  return resolvePromptKeybindings(defaults, user, mac)
}

/** Call `cb` when the user's keybindings.json is created, changed, or deleted. */
export function watchKeybindings(context: vscode.ExtensionContext, cb: () => void): vscode.Disposable {
  const watchers = userKeybindingFiles(context.globalStorageUri.fsPath).map((file) =>
    vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
    ),
  )
  for (const watcher of watchers) {
    watcher.onDidChange(cb)
    watcher.onDidCreate(cb)
    watcher.onDidDelete(cb)
  }
  return vscode.Disposable.from(...watchers)
}

/** Whether the active editor has selected text. "Add to context" only works while it does. */
export function promptSelection(): boolean {
  return vscode.window.activeTextEditor?.selections.some((selection) => !selection.isEmpty) ?? false
}

/**
 * Call `cb` when the context of the prompt hint changes: the user's keybindings, or whether an editor selection
 * exists. The selection is the only editor state the hint reads, so moving the caret alone does not repaint it.
 */
export function watchPromptContext(context: vscode.ExtensionContext, cb: () => void): vscode.Disposable {
  let last = promptSelection()
  const sync = () => {
    const next = promptSelection()
    if (next === last) return
    last = next
    cb()
  }
  return vscode.Disposable.from(
    watchKeybindings(context, cb),
    vscode.window.onDidChangeTextEditorSelection(sync),
    vscode.window.onDidChangeActiveTextEditor(sync),
  )
}
