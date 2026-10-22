import { beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  autocompleteScope,
  getNotebookContext,
  notebookUri,
  supportsNotebook,
} from "../../src/services/autocomplete/continuedev/core/autocomplete/notebook"
import { accessible } from "../../src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider"
import { constructInitialPrefixSuffix } from "../../src/services/autocomplete/continuedev/core/autocomplete/templating/constructPrefixSuffix"
import type { FileIgnoreController } from "../../src/services/autocomplete/shims/FileIgnoreController"
import type { AutocompleteInput } from "../../src/services/autocomplete/types"

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

  it("projects mixed-language context for the active Python cell", () => {
    const markdown = document("markdown", "# Title\nNotes", "markdown")
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
      contents: `# [markdown] # Title\n# Notes\n\n# [javascript] const value = 1\n# value += 1\n\nprint(value)\nprint('done')`,
      filepath: "/workspace/example.ipynb",
      position: new vscode.Position(7, 5),
    })
  })

  it("projects mixed-language context for the active JavaScript cell", () => {
    const markdown = document("markdown", "Setup\nvalues", "markdown")
    const python = document("python", "value = 1\nprint(value)")
    const current = document("current", "const value = 1", "javascript")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [
        { kind: vscode.NotebookCellKind.Markup, document: markdown },
        { kind: vscode.NotebookCellKind.Code, document: python },
        { kind: vscode.NotebookCellKind.Code, document: current },
      ],
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(getNotebookContext(current, new vscode.Position(0, 6))).toEqual({
      contents: `// [markdown] Setup\n// values\n\n// [python] value = 1\n// print(value)\n\nconst value = 1`,
      filepath: "/workspace/example.ipynb",
      position: new vscode.Position(6, 6),
    })
  })

  it("supports known code languages and rejects non-code or unknown cells", () => {
    const cells = [
      document("python", "value = 1"),
      document("javascript", "const value = 1", "javascript"),
      document("typescript", "const value: number = 1", "typescript"),
      document("r", "value <- 1", "r"),
      document("julia", "value = 1", "julia"),
      document("jsonc", "{ // comment\n}", "jsonc"),
      document("luau", "local value = 1", "luau"),
      document("unknown", "value = 1", "custom-language"),
      document("markdown", "# Heading", "markdown"),
    ]
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () =>
        cells.map((document, index) => ({
          kind: index === cells.length - 1 ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
          document,
        })),
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(cells.slice(0, 7).every(supportsNotebook)).toBe(true)
    expect(supportsNotebook(cells[7]!)).toBe(false)
    expect(supportsNotebook(cells[8]!)).toBe(false)
    expect(getNotebookContext(cells[7]!, new vscode.Position(0, 0))).toBeUndefined()
    expect(supportsNotebook({ uri: uri("file", "/workspace/file.ts") } as vscode.TextDocument)).toBe(true)
  })

  it("omits foreign and markup content from strict JSON context", () => {
    const markdown = document("markdown", "Describe values", "markdown")
    const javascript = document("javascript", "const value = 1", "javascript")
    const sibling = document("sibling", '{"other": 2}', "json")
    const current = document("current", '{"value": 1}', "json")
    const notebook = {
      uri: uri("file", "/workspace/example.ipynb"),
      getCells: () => [
        { kind: vscode.NotebookCellKind.Markup, document: markdown },
        { kind: vscode.NotebookCellKind.Code, document: javascript },
        { kind: vscode.NotebookCellKind.Code, document: sibling },
        { kind: vscode.NotebookCellKind.Code, document: current },
      ],
    } as vscode.NotebookDocument
    notebooks([notebook])

    expect(getNotebookContext(current, new vscode.Position(0, 3))).toEqual({
      contents: `\n\n\n\n\n\n{"value": 1}`,
      filepath: "/workspace/example.ipynb",
      position: new vscode.Position(6, 3),
    })
  })

  it("uses the active cell language when constructing notebook prompts", async () => {
    const input: AutocompleteInput = {
      isUntitledFile: false,
      completionId: "completion",
      filepath: "/workspace/example.ipynb",
      languageId: "javascript",
      pos: { line: 0, character: 5 },
      recentlyVisitedRanges: [],
      recentlyEditedRanges: [],
      manuallyPassFileContents: "value = 1",
      injectDetails: "notebook context",
    }

    const result = await constructInitialPrefixSuffix(input, {} as never)

    expect(result.prefix).toBe("\n// notebook context\nvalue")
    expect(result.suffix).toBe(" = 1")
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

    const changed = autocompleteScope(current)
    Object.assign(current, { languageId: "javascript" })
    Object.assign(notebook, { version: 4 })
    expect(autocompleteScope(current)).not.toBe(changed)
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
