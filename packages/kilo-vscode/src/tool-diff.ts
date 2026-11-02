// Opens tool-call results in VS Code: a file at a line, or a native diff of the before and after text of one file.
// The diff side documents are virtual, because a tool call has no file on disk that holds the before state.
import { commands, Range, Uri, window, workspace, type TextDocumentContentProvider } from "vscode"
import type { ToolActionDiff } from "./protocol"
import { resolveToolFilePath, virtualDiffPath } from "./tool-diff-path"
import { filePosition, patchFiles } from "./tool-diff-patch"

const SCHEME = "kilo-tool-diff"

/** The virtual document provider for tool diffs. Register `provider` once during activation. */
export function toolDiff() {
  const documents = new Map<string, string>()
  let sequence = 0
  const provider: TextDocumentContentProvider = {
    provideTextDocumentContent: (uri) => documents.get(uri.toString()) ?? "",
  }
  // Each diff gets new ids, so its two documents are never reused. Deleting them when they close keeps the map
  // bounded without blanking a diff that is still open.
  const closed = workspace.onDidCloseTextDocument((document) => {
    if (document.uri.scheme === SCHEME) documents.delete(document.uri.toString())
  })
  const openOne = (file: string, before: string, after: string, preview: boolean) => {
    const name = file.split(/[\\/]/).pop() || file
    const id = `${sequence++}`
    const left = virtualUri(id, "before", file)
    const right = virtualUri(id, "after", file)
    documents.set(left.toString(), before)
    documents.set(right.toString(), after)
    void commands
      .executeCommand("vscode.diff", left, right, `Changes: ${name}`, { preview })
      .then(undefined, (error: unknown) => report(`Could not open the diff for ${file}`, error))
  }
  /**
   * One native diff per file, in patch order. VS Code has no combined multi-file diff, so a multi-file patch opens
   * one editor per file. A single file stays a preview tab; several files are kept as tabs so none replaces another.
   *
   * A native diff editor follows the user's `diffEditor.renderSideBySide` setting, so `initialDiffStyle` cannot
   * change the layout of this diff. The argument stays in the protocol for clients that send it.
   */
  const openMany = (diffs: ToolActionDiff[], _initialDiffStyle?: "unified" | "split") => {
    const files = diffs.flatMap((diff) =>
      patchFiles(diff.patch).map((part) => ({
        file: part.file || diff.file,
        before: part.before,
        after: part.after,
      })),
    )
    const preview = files.length === 1
    for (const file of files) openOne(file.file, file.before, file.after, preview)
  }
  return {
    scheme: SCHEME,
    provider,
    /** One file's patch. A combined patch opens every file it carries. */
    open: (diff: ToolActionDiff, initialDiffStyle?: "unified" | "split") => openMany([diff], initialDiffStyle),
    openMany,
    dispose() {
      closed.dispose()
      documents.clear()
    },
  }
}

export type ToolDiff = ReturnType<typeof toolDiff>

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

function virtualUri(id: string, side: "before" | "after", file: string) {
  return Uri.from({ scheme: SCHEME, path: virtualDiffPath(id, side, file) })
}

function report(headline: string, error: unknown) {
  void window.showErrorMessage(`${headline}: ${error instanceof Error ? error.message : String(error)}`)
}
