// Opens tool-call results in VS Code: a file at a line. Tool diffs open in the Kilo diff viewer
// (`DiffVirtualProvider`), which implements `ToolDiff`.
import { Range, Uri, window, workspace } from "vscode"
import type { ToolActionDiff } from "./protocol"
import { filePosition } from "./tool-diff-patch"
import { resolveToolFilePath } from "./tool-diff-path"

/** The tool diff surfaces the chat view opens: a diff of one call or of several, and their lifetime. */
export type ToolDiff = {
  open(diff: ToolActionDiff, initialDiffStyle?: "unified" | "split"): void
  openMany(diffs: ToolActionDiff[], initialDiffStyle?: "unified" | "split"): void
  dispose(): void
}

/** Opens a file relative to the workspace, or at its absolute path, at a 1-based line and column when given. */
export function openToolFile(directory: string, message: { filePath: string; line?: number; column?: number }) {
  const uri = Uri.file(resolveToolFilePath(directory, message.filePath))
  const position = filePosition(message.line, message.column)
  const selection = position && new Range(position.line, position.column, position.line, position.column)
  void workspace
    .openTextDocument(uri)
    .then(
      (document) => window.showTextDocument(document, { preview: true, selection }),
      (error: unknown) => report(`Could not open ${message.filePath}`, error),
    )
}

function report(headline: string, error: unknown) {
  void window.showErrorMessage(`${headline}: ${error instanceof Error ? error.message : String(error)}`)
}
