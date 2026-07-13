// Copied from Continue's VS Code autocomplete provider:
// https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/completionProvider.ts#L226-L263
// Copyright 2023 Continue
// Licensed under the Apache License, Version 2.0.
// Modified by Kilo Code for notebook paths, cursor positions, multilingual context, and cache scoping.

import * as vscode from "vscode"
import { languageForId } from "./constants/AutocompleteLanguageInfo"

export interface NotebookContext {
  contents: string
  filepath: string
  position: vscode.Position
}

interface NotebookResolution {
  notebook: vscode.NotebookDocument
  cells: vscode.NotebookCell[]
  cell: vscode.NotebookCell
  index: number
  version: number
}

const resolutions = new WeakMap<vscode.Uri, NotebookResolution>()

function resolveNotebook(uri: vscode.Uri): NotebookResolution | undefined {
  const id = uri.toString()
  const cached = resolutions.get(uri)
  if (
    cached &&
    cached.notebook.version === cached.version &&
    vscode.workspace.notebookDocuments.includes(cached.notebook)
  ) {
    return cached
  }

  resolutions.delete(uri)
  for (const notebook of vscode.workspace.notebookDocuments) {
    const cells = notebook.getCells()
    const index = cells.findIndex((cell) => cell.document.uri.toString() === id)
    if (index < 0) continue
    const resolved = { notebook, cells, cell: cells[index]!, index, version: notebook.version }
    resolutions.set(uri, resolved)
    return resolved
  }
}

export function notebookUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme === "file") return uri
  if (uri.scheme !== "vscode-notebook-cell") return
  return resolveNotebook(uri)?.notebook.uri
}

export function supportsNotebook(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "vscode-notebook-cell") return true
  const resolved = resolveNotebook(document.uri)
  return resolved?.cell.kind === vscode.NotebookCellKind.Code && !!languageForId(document.languageId)
}

export function autocompleteScope(document: vscode.TextDocument): string {
  const id = document.uri.toString()
  const resolved = resolveNotebook(document.uri)
  if (!resolved) return id

  const siblings = resolved.cells
    .filter((_, index) => index !== resolved.index)
    .map((cell) => [cell.document.uri.toString(), cell.kind, cell.document.languageId, cell.document.version])
  return JSON.stringify([id, document.languageId, resolved.notebook.uri.toString(), resolved.index, siblings])
}

export function getNotebookContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): NotebookContext | undefined {
  if (document.uri.scheme !== "vscode-notebook-cell" || !supportsNotebook(document)) return

  const resolved = resolveNotebook(document.uri)
  if (!resolved) return

  const cells = resolved.cells
  const lang = languageForId(document.languageId)
  if (!lang) return

  const json = document.languageId === "json" || document.languageId === "jsonc"
  const marker = json ? undefined : lang.singleLineComment
  const comment = (text: string, label: string) =>
    text
      .split("\n")
      .map((line, index) => (marker ? `${marker} ${index === 0 ? `[${label}] ` : ""}${line}` : ""))
      .join("\n")

  const contents = cells
    .map((cell, index) => {
      const text = cell.document.getText()
      if (index === resolved.index) return text
      if (cell.kind === vscode.NotebookCellKind.Markup) return comment(text, "markdown")
      if (!json && languageForId(cell.document.languageId) === lang) return text
      return comment(text, cell.document.languageId)
    })
    .join("\n\n")

  const line = cells
    .slice(0, resolved.index)
    .reduce((line, cell) => line + cell.document.getText().split("\n").length + 1, position.line)

  return {
    contents,
    filepath: resolved.notebook.uri.fsPath,
    position: new vscode.Position(line, position.character),
  }
}
