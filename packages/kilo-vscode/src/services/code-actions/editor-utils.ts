import { pathToFileURL } from "node:url"
import { languages, window, workspace, type Diagnostic } from "vscode"

export type EditorContext = {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: Diagnostic[]
  /** The document URI as a `file:` URL when the document is on disk. */
  source?: string
}

export function getEditorContext(): EditorContext | undefined {
  const editor = window.activeTextEditor
  if (!editor) return undefined
  const selection = editor.selection
  if (selection.isEmpty) return undefined
  const doc = editor.document
  return {
    filePath: workspace.asRelativePath(doc.uri),
    selectedText: doc.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    diagnostics: languages.getDiagnostics(doc.uri).filter((d) => d.range.intersection(selection) !== undefined),
    source: doc.uri.scheme === "file" ? pathToFileURL(doc.uri.fsPath).href : undefined,
  }
}
