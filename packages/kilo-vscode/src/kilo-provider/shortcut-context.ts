import * as vscode from "vscode"
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { mergeUserKeybindings, parseJsonc, userKeybindingFiles } from "../keybinding-format"

const files = (ctx?: vscode.ExtensionContext) =>
  ctx?.globalStorageUri ? userKeybindingFiles(ctx.globalStorageUri.fsPath) : []

/** Read one keybindings file. A missing or transiently unreadable file must not break setup. */
function readKeybindings(file: string): unknown {
  try {
    return parseJsonc(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

/** Extension keybindings with the user's keybindings.json applied, for the current platform. */
export function keybindings(ctx?: vscode.ExtensionContext) {
  const ext = vscode.extensions.getExtension("kilocode.kilo-code-v2")
  const defaults = ext?.packageJSON?.contributes?.keybindings ?? []
  const user = files(ctx)
    .map(readKeybindings)
    .find((value) => value !== undefined)
  return mergeUserKeybindings(defaults, user, process.platform === "darwin")
}

/** Call cb when the user's keybindings.json is created, changed, or deleted. */
export function watchKeybindings(ctx: vscode.ExtensionContext | undefined, cb: () => void): vscode.Disposable {
  const watchers = files(ctx).map((file) =>
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
