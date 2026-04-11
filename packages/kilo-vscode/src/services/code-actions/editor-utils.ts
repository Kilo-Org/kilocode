import * as vscode from "vscode"

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

interface SavedSelection {
  selection: vscode.Selection
  documentUri: string
}

let lastNonEmptySelection: SavedSelection | undefined

/**
 * Tracks the last user-initiated non-empty selection. This is used as a fallback
 * in getEditorContext() to handle the case where a programmatic (Command-kind)
 * selection change clears the selection before the context menu command handler runs.
 */
export function initSelectionTracker(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      // Ignore only explicit programmatic changes (TextEditorSelectionChangeKind.Command).
      // Mouse, Keyboard, and undefined-kind events all represent user-driven selection
      // activity and must be captured — VS Code often fires selection events with
      // kind=undefined (e.g. mouse-drag selections), so checking for Mouse/Keyboard
      // alone is not sufficient.
      if (e.kind !== vscode.TextEditorSelectionChangeKind.Command) {
        const selection = e.selections[0]
        if (selection && !selection.isEmpty) {
          lastNonEmptySelection = {
            selection,
            documentUri: e.textEditor.document.uri.toString(),
          }
        } else {
          // User explicitly cleared their selection — reset the fallback too
          lastNonEmptySelection = undefined
        }
      }
    }),
  )
}

export function getEditorContext(): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined

  let selection = editor.selection

  // Fallback: if the current selection was cleared by a programmatic (Command-kind) event,
  // use the last user-initiated selection for the same document.
  if (selection.isEmpty && lastNonEmptySelection?.documentUri === editor.document.uri.toString()) {
    selection = lastNonEmptySelection.selection
  }

  if (selection.isEmpty) return undefined
  const doc = editor.document
  return {
    filePath: vscode.workspace.asRelativePath(doc.uri),
    selectedText: doc.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    diagnostics: vscode.languages.getDiagnostics(doc.uri).filter((d) => d.range.intersection(selection) !== undefined),
  }
}
