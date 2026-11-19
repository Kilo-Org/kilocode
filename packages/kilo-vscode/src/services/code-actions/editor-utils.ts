import * as vscode from "vscode"

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

// Command arguments from a code action round-trip through the extension host RPC, which JSON-serializes them:
// vscode.Range and vscode.Position come back as plain {start, end} objects without prototype or getters, so the
// shape has to be checked structurally instead of with instanceof and the isEmpty getter.
function isRange(value: unknown): value is vscode.Range {
  const candidate = value as {
    start?: { line?: unknown; character?: unknown }
    end?: { line?: unknown; character?: unknown }
  }
  return (
    typeof candidate?.start?.line === "number" &&
    typeof candidate?.start?.character === "number" &&
    typeof candidate?.end?.line === "number" &&
    typeof candidate?.end?.character === "number"
  )
}

function isEmpty(range: vscode.Range): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character
}

/**
 * @param range code action range; Quick Fix passes it because the editor selection is usually empty there
 * @param diagnostics diagnostics of the code action; looked up for the range if not given
 */
export function getEditorContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const selection = isRange(range) && !isEmpty(range) ? range : editor.selection
  if (isEmpty(selection)) return undefined
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
