/**
 * The workspace root chosen in the chat input of a multi-root window.
 *
 * The root is always a manual choice, never inferred from the active editor,
 * so the folder a session works in only changes when the user changes it.
 * It is stored in workspace state, so the sidebar, Kilo tabs and Settings in
 * the window share it and a reopened window starts from it. Until the user
 * picks one, the first workspace folder is used.
 */

import * as vscode from "vscode"
import { folderFor } from "./workspace-folders"

const KEY = "kilo.workspaceRoot"
const listeners = new Set<() => void>()
let bound: vscode.Memento | undefined

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
}

/** Bind the window's workspace state once at activation, for callers that have no extension context. */
export function bindRootState(context: vscode.ExtensionContext): void {
  bound = context.workspaceState
}

/** The selected root, or the first folder; `fallback` stands in for the stored choice when there is no state. */
export function selectedRoot(context?: vscode.ExtensionContext, fallback?: string): string | undefined {
  const roots = workspaceRoots()
  const saved = (context?.workspaceState ?? bound)?.get<string>(KEY) ?? fallback
  return (saved ? folderFor(saved, roots) : undefined) ?? roots.at(0)
}

export async function selectRoot(context: vscode.ExtensionContext | undefined, dir: string): Promise<void> {
  await context?.workspaceState?.update(KEY, dir)
  for (const fn of listeners) fn()
}

/** Run `fn` whenever any panel in this window picks another root. */
export function watchRoot(fn: () => void): vscode.Disposable {
  listeners.add(fn)
  return { dispose: () => listeners.delete(fn) }
}
