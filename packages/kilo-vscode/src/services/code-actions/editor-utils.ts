import * as vscode from "vscode"

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

/**
 * @param range code action range; Quick Fix passes it because the editor selection is usually empty there
 * @param diagnostics diagnostics of the code action; looked up for the range if not given
 */
export function getEditorContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const selection = range instanceof vscode.Range && !range.isEmpty ? range : editor.selection
  if (selection.isEmpty) return undefined
  const doc = editor.document
  return {
    filePath: vscode.workspace.asRelativePath(doc.uri),
    selectedText: doc.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    diagnostics:
      Array.isArray(diagnostics) && diagnostics.length > 0
        ? diagnostics
        : vscode.languages.getDiagnostics(doc.uri).filter((d) => d.range.intersection(selection) !== undefined),
  }
}
