import { beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  autocompleteScope,
  getNotebookContext,
  notebookUri,
  supportsNotebook,
} from "../../src/services/autocomplete/continuedev/core/autocomplete/notebook"
import { accessible } from "../../src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider"
import type { FileIgnoreController } from "../../src/services/autocomplete/shims/FileIgnoreController"

function uri(scheme: string, path: string, fragment = ""): vscode.Uri {
  const value = `${scheme}:${path}${fragment ? `#${fragment}` : ""}`
  return {
    scheme,
    fsPath: path,
    toString: () => value,
  } as vscode.Uri
}

function document(id: string, text: string, languageId = "python", version = 1): vscode.TextDocument {
  return {
    uri: uri("vscode-notebook-cell", "/workspace/example.ipynb", id),
    fileName: `/workspace/${id}.py`,
    languageId,
    version,
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
    const code = document("code", "const value = 1\nvalue += 1", "javascript")
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
      contents: `"""# Title\nNotes"""\n\nconst value = 1\nvalue += 1\n\nprint(value)\nprint('done')`,
      filepath: "/workspace/example.ipynb",
      position: new vscode.Position(7, 5),
    })
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
    expect(getNotebookContext(javascript, new vscode.Position(0, 0))).toBeUndefined()
    expect(getNotebookContext(markdown, new vscode.Position(0, 0))).toBeUndefined()
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

  it("scopes autocomplete cache to the cell and sibling versions", () => {
    const current = document("current", "value = 1")
    const sibling = document("sibling", "other = 1")
    const cells = [
      { kind: vscode.NotebookCellKind.Code, document: current },
      { kind: vscode.NotebookCellKind.Code, document: sibling },
    ] as vscode.NotebookCell[]
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      version: 1,
      getCells: () => cells,
    } as vscode.NotebookDocument
    notebooks([notebook])

    const initial = autocompleteScope(current)
    Object.assign(current, { version: 2 })
    Object.assign(notebook, { version: 2 })
    expect(autocompleteScope(current)).toBe(initial)

    Object.assign(sibling, { version: 2 })
    Object.assign(notebook, { version: 3 })
    expect(autocompleteScope(current)).not.toBe(initial)
    expect(autocompleteScope(current)).not.toBe(autocompleteScope(sibling))
  })

  it("changes autocomplete scope when sibling order changes", () => {
    const current = document("current", "value = 1")
    const first = document("first", "first = 1")
    const second = document("second", "second = 1")
    const cells = [
      { kind: vscode.NotebookCellKind.Code, document: first },
      { kind: vscode.NotebookCellKind.Code, document: second },
      { kind: vscode.NotebookCellKind.Code, document: current },
    ] as vscode.NotebookCell[]
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      version: 1,
      getCells: () => cells,
    } as vscode.NotebookDocument
    notebooks([notebook])

    const initial = autocompleteScope(current)
    cells.splice(0, 2, cells[1]!, cells[0]!)
    Object.assign(notebook, { version: 2 })

    expect(autocompleteScope(current)).not.toBe(initial)
  })

  it("reuses notebook resolution within the same notebook version", () => {
    const current = document("current", "value = 1")
    const cells = [{ kind: vscode.NotebookCellKind.Code, document: current }] as vscode.NotebookCell[]
    let calls = 0
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      version: 1,
      getCells: () => {
        calls++
        return cells
      },
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(supportsNotebook(current)).toBe(true)
    expect(notebookUri(current.uri)).toBe(notebook.uri)
    expect(getNotebookContext(current, new vscode.Position(0, 0))).toBeDefined()
    expect(calls).toBe(1)
  })

  it("validates notebook parent paths regardless of URI scheme", () => {
    for (const scheme of ["file", "untitled", "memfs"]) {
      const cell = document(scheme, "value = 1")
      const notebook = {
        uri: uri(scheme, `/workspace/${scheme}.ipynb`),
        getCells: () => [{ kind: vscode.NotebookCellKind.Code, document: cell }],
      } as vscode.NotebookDocument
      const paths: string[] = []
      const controller = {
        validateAccess: (path: string) => {
          paths.push(path)
          return false
        },
      } as FileIgnoreController
      notebooks([notebook])

      expect(accessible(controller, cell)).toBe(false)
      expect(paths).toEqual([`/workspace/${scheme}.ipynb`])
    }
  })
})
