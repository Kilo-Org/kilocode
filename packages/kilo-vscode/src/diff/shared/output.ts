import * as vscode from "vscode"
import { inspect } from "util"

export function appendOutput(channel: vscode.OutputChannel, prefix: string, ...args: unknown[]): void {
  const msg = args
    .map((item) => (typeof item === "string" ? item : inspect(item, { breakLength: Infinity, depth: 4 })))
    .join(" ")
  channel.appendLine(`[${prefix}] ${msg}`)
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) return folders[0].uri.fsPath
  return undefined
}