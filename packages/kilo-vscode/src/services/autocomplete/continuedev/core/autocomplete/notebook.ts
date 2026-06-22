// Copied from Continue's VS Code autocomplete provider:
// https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/completionProvider.ts#L226-L263
// Copyright 2023 Continue
// Licensed under the Apache License, Version 2.0.
// Modified by Kilo Code for notebook paths, cursor positions, and cache scoping.

import { createHash } from "node:crypto"
import * as vscode from "vscode"

export interface NotebookContext {
  contents: string
  filepath: string
  position: vscode.Position
}

function resolveNotebook(uri: vscode.Uri): vscode.NotebookDocument | undefined {
  return vscode.workspace.notebookDocuments.find((notebook) =>
    notebook.getCells().some((cell) => cell.document.uri.toString() === uri.toString()),
  )
}

export function notebookUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme === "file") return uri
  if (uri.scheme !== "vscode-notebook-cell") return
  return resolveNotebook(uri)?.uri
}

export function supportsNotebook(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "vscode-notebook-cell") return true
  const cell = resolveNotebook(document.uri)
    ?.getCells()
    .find((cell) => cell.document.uri.toString() === document.uri.toString())
  return cell?.kind === vscode.NotebookCellKind.Code && document.languageId === "python"
}

export function autocompleteScope(document: vscode.TextDocument): string {
  const id = document.uri.toString()
  const notebook = resolveNotebook(document.uri)
  if (!notebook) return id

  const context = notebook
    .getCells()
    .filter((cell) => cell.document.uri.toString() !== id)
    .map((cell) => `${cell.kind}:${cell.document.uri.toString()}:${cell.document.getText()}`)
    .join("\0")
  const hash = createHash("sha256").update(context).digest("hex")
  return `${id}:${hash}`
}

export function getNotebookContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): NotebookContext | undefined {
  if (document.uri.scheme !== "vscode-notebook-cell") return

  const notebook = resolveNotebook(document.uri)
  if (!notebook) return

  const cells = notebook.getCells()
  const contents = cells
    .map((cell) => {
      const text = cell.document.getText()
      if (cell.kind === vscode.NotebookCellKind.Markup) {
        return `"""${text}"""`
      }
      return text
    })
    .join("\n\n")

  const index = cells.findIndex((cell) => cell.document.uri.toString() === document.uri.toString())
  const line = cells
    .slice(0, index)
    .reduce((line, cell) => line + cell.document.getText().split("\n").length + 1, position.line)
  const cell = cells[index]
  const character =
    cell.kind === vscode.NotebookCellKind.Markup && position.line === 0 ? position.character + 3 : position.character

  return {
    contents,
    filepath: notebook.uri.fsPath,
    position: new vscode.Position(line, character),
  }
}
