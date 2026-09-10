import { createHash } from "node:crypto"
import * as vscode from "vscode"

export interface NotebookState {
  revision: string
  cells: string[]
}

function hash(parts: string[]): string {
  const value = createHash("sha256")
  for (const part of parts) {
    value.update(String(Buffer.byteLength(part)))
    value.update(":")
    value.update(part)
  }
  return value.digest("base64url")
}

export function fingerprint(kind: "code" | "markdown", language: string, source: string): string {
  return hash([kind, language, source])
}

export function cellFingerprint(cell: vscode.NotebookCell): string {
  return fingerprint(
    cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
    cell.document.languageId,
    cell.document.getText(),
  )
}

export function notebookState(document: vscode.NotebookDocument): NotebookState {
  const cells = document.getCells().map(cellFingerprint)
  return { revision: `content:${hash(cells)}`, cells }
}

export function sameCell(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && left === right
}
