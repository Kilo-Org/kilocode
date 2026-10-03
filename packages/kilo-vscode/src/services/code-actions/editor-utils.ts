import * as path from "path"
import * as vscode from "vscode"
import { within } from "../../workspace-folders"

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

/**
 * The path a code action hands to the model.
 *
 * Single-folder windows keep the workspace-relative path. In a multi-root
 * window `asRelativePath` prefixes the folder name ("beta/src/b.ts"), which no
 * session can resolve, so the path is relative to `root` (the folder the chat
 * works in) when the file is inside it and absolute otherwise.
 */
export function codePath(uri: vscode.Uri, root?: string): string {
  if ((vscode.workspace.workspaceFolders?.length ?? 0) < 2 || uri.scheme !== "file") {
    return vscode.workspace.asRelativePath(uri)
  }
  if (root && within(root, uri.fsPath)) return path.relative(root, uri.fsPath).replaceAll("\\", "/")
  return uri.fsPath.replaceAll("\\", "/")
}

export function getEditorContext(root?: string): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const selection = editor.selection
  if (selection.isEmpty) return undefined
  const doc = editor.document
  return {
    filePath: codePath(doc.uri, root),
    selectedText: doc.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    diagnostics: vscode.languages.getDiagnostics(doc.uri).filter((d) => d.range.intersection(selection) !== undefined),
  }
}
