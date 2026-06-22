import { beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  getNotebookContext,
  notebookUri,
  supportsNotebook,
} from "../../src/services/autocomplete/continuedev/core/autocomplete/notebook"

function uri(scheme: string, path: string, fragment = ""): vscode.Uri {
  const value = `${scheme}:${path}${fragment ? `#${fragment}` : ""}`
  return {
    scheme,
    fsPath: path,
    toString: () => value,
  } as vscode.Uri
}

function document(id: string, text: string, languageId = "python"): vscode.TextDocument {
  return {
    uri: uri("vscode-notebook-cell", "/workspace/example.ipynb", id),
    languageId,
    getText: () => text,
  } as vscode.TextDocument
}

function notebooks(value: vscode.NotebookDocument[]): void {
  Object.defineProperty(vscode.workspace, "notebookDocuments", {
    configurable: true,
    value,
  })
}

describe("notebook context", () => {
  beforeEach(() => notebooks([]))

  it("flattens notebook cells and translates the cursor", () => {
    const markdown = document("markdown", "# Title\nNotes")
    const code = document("code", "value = 1\nvalue += 1")
    const current = document("current", "print(value)\nprint('done')")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [
        { kind: vscode.NotebookCellKind.Markup, document: markdown },
        { kind: vscode.NotebookCellKind.Code, document: code },
        { kind: vscode.NotebookCellKind.Code, document: current },
      ],
    } as vscode.NotebookDocument
    notebooks([notebook])

    const context = getNotebookContext(current, new vscode.Position(1, 5))

    expect(context).toEqual({
      contents: `"""# Title\nNotes"""\n\nvalue = 1\nvalue += 1\n\nprint(value)\nprint('done')`,
      filepath: "/workspace/example.ipynb",
      position: new vscode.Position(7, 5),
    })
  })

  it("accounts for the opening quotes in a markup cell", () => {
    const current = document("current", "# Heading", "markdown")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [{ kind: vscode.NotebookCellKind.Markup, document: current }],
    } as vscode.NotebookDocument
    notebooks([notebook])

    const context = getNotebookContext(current, new vscode.Position(0, 4))

    expect(context?.position).toEqual(new vscode.Position(0, 7))
  })

  it("limits notebook completion to Python code cells", () => {
    const python = document("python", "value = 1")
    const javascript = document("javascript", "const value = 1", "javascript")
    const markdown = document("markdown", "# Heading", "markdown")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [
        { kind: vscode.NotebookCellKind.Code, document: python },
        { kind: vscode.NotebookCellKind.Code, document: javascript },
        { kind: vscode.NotebookCellKind.Markup, document: markdown },
      ],
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(supportsNotebook(python)).toBe(true)
    expect(supportsNotebook(javascript)).toBe(false)
    expect(supportsNotebook(markdown)).toBe(false)
    expect(supportsNotebook({ uri: uri("file", "/workspace/file.ts") } as vscode.TextDocument)).toBe(true)
  })

  it("resolves file and notebook cell URIs", () => {
    const file = uri("file", "/workspace/file.ts")
    const cell = document("code", "value = 1")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [{ kind: vscode.NotebookCellKind.Code, document: cell }],
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(notebookUri(file)).toBe(file)
    expect(notebookUri(cell.uri)).toBe(notebook.uri)
    expect(notebookUri(uri("untitled", "Untitled-1"))).toBeUndefined()
  })
})
