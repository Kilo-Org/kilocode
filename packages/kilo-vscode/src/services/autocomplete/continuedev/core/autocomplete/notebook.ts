// Copied from Continue's VS Code autocomplete provider:
// https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/completionProvider.ts#L226-L263
// Copyright 2023 Continue
// Licensed under the Apache License, Version 2.0.

import * as vscode from "vscode"

export interface NotebookContext {
  contents: string
  filepath: string
  position: vscode.Position
}

export function getNotebookContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): NotebookContext | undefined {
  if (document.uri.scheme !== "vscode-notebook-cell") return

  const notebook = vscode.workspace.notebookDocuments.find((notebook) =>
    notebook.getCells().some((cell) => cell.document.uri.toString() === document.uri.toString()),
  )
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

  return {
    contents,
    filepath: notebook.uri.fsPath,
    position: new vscode.Position(line, position.character),
  }
}
