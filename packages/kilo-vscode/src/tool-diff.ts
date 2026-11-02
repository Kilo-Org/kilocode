// Opens tool-call results in VS Code: a file at a line, or a native diff of the before and after text of one file.
// The diff side documents are virtual, because a tool call has no file on disk that holds the before state.
import path from "node:path"
import { commands, Range, Uri, window, workspace, type TextDocumentContentProvider } from "vscode"
import type { ToolActionDiff } from "./protocol"
import { filePosition, patchDocuments } from "./tool-diff-patch"

const SCHEME = "kilo-tool-diff"

/** The virtual document provider for tool diffs. Register `provider` once during activation. */
export function toolDiff() {
  const documents = new Map<string, string>()
  let sequence = 0
  const provider: TextDocumentContentProvider = {
    provideTextDocumentContent: (uri) => documents.get(uri.toString()) ?? "",
  }
  return {
    scheme: SCHEME,
    provider,
    /**
     * A native diff editor follows the user's `diffEditor.renderSideBySide` setting, so `initialDiffStyle` cannot
     * change the layout of this diff. The argument stays in the protocol for clients that send it.
     */
    open(diff: ToolActionDiff, _initialDiffStyle?: "unified" | "split") {
      const { before, after } = patchDocuments(diff.patch)
      const name = diff.file.split(/[\\/]/).pop() || diff.file
      const id = `${sequence++}`
      const left = virtualUri(id, "before", diff.file)
      const right = virtualUri(id, "after", diff.file)
      documents.set(left.toString(), before)
      documents.set(right.toString(), after)
      void commands
        .executeCommand("vscode.diff", left, right, `Changes: ${name}`, { preview: true })
        .then(undefined, (error: unknown) => report(`Could not open the diff for ${diff.file}`, error))
    },
    dispose() {
      documents.clear()
    },
  }
}

export type ToolDiff = ReturnType<typeof toolDiff>

/** Opens a file relative to the workspace, or at its absolute path, at a 1-based line and column when given. */
export function openToolFile(directory: string, message: { filePath: string; line?: number; column?: number }) {
  const uri = path.isAbsolute(message.filePath)
    ? Uri.file(message.filePath)
    : Uri.joinPath(Uri.file(directory), message.filePath)
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
  return Uri.from({ scheme: SCHEME, path: `/${id}/${side}/${file.replace(/^\/+/, "")}` })
}

function report(headline: string, error: unknown) {
  void window.showErrorMessage(`${headline}: ${error instanceof Error ? error.message : String(error)}`)
}
