import * as vscode from 'vscode'

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

// Command arguments from a code action round-trip through the extension host
// RPC, which JSON-serializes them: vscode.Range and vscode.Position come back
// as plain {start, end} objects without prototype or getters, so the shape has
// to be checked structurally instead of with instanceof and the isEmpty getter.
function isRange(value: unknown): value is vscode.Range {
  const candidate = value as {
    start?: { line?: unknown; character?: unknown }
    end?: { line?: unknown; character?: unknown }
  }
  return (
    typeof candidate?.start?.line === 'number' &&
    typeof candidate?.start?.character === 'number' &&
    typeof candidate?.end?.line === 'number' &&
    typeof candidate?.end?.character === 'number'
  )
}

function isEmpty(range: vscode.Range): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character
}

// The code action range belongs to the document the provider ran on, which may not be the active editor's
// document - resolve it by uri instead of trusting the active editor. A document that closed since the action
// was provided cannot be resolved and makes the code action stale.
function document(uri?: string): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor?.document
  if (!uri) return active
  if (active?.uri.toString() === uri) return active
  return vscode.workspace.textDocuments.find((other) => other.uri.toString() === uri)
}

/**
 * @param range code action range; code actions pass it because the editor selection is usually empty there
 * @param diagnostics diagnostics of the code action; looked up for the range if not given
 * @param uri string form of the document the code action was provided for; without it the active editor is used
 * and the editor selection may serve as fallback, which is only valid for the active document
 */
export function getEditorContext(
  range?: vscode.Range,
  diagnostics?: vscode.Diagnostic[],
  uri?: string,
): EditorContext | undefined {
  const doc = document(uri)
  if (!doc) return undefined
  const selection =
    isRange(range) && !isEmpty(range)
      ? range
      : doc === vscode.window.activeTextEditor?.document
        ? vscode.window.activeTextEditor?.selection
        : undefined
  if (!selection || isEmpty(selection)) return undefined
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
