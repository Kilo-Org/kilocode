import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { NotebookAdapter } from "../../src/services/notebook/adapter"
import { normalizeOutputs, normalizeSource } from "../../src/services/notebook/output"
import { NotebookError, resolveNotebookPath } from "../../src/services/notebook/path"
import type { NotebookAdapterDeps, NotebookCellInput } from "../../src/services/notebook/types"

interface CellState {
  source: string
  kind: vscode.NotebookCellKind
  language: string
  outputs: vscode.NotebookCellOutput[]
  execution?: vscode.NotebookCellExecutionSummary
}

function uri(path: string): vscode.Uri {
  return { scheme: "file", fsPath: path, path, toString: () => `file://${path}` } as vscode.Uri
}

function cell(source = "print('hi')", kind = vscode.NotebookCellKind.Code, language?: string) {
  const state: CellState = {
    source,
    kind,
    language: language ?? (kind === vscode.NotebookCellKind.Code ? "python" : "markdown"),
    outputs: [],
  }
  const getText = mock((range?: vscode.Range) => {
    const offset = (range?.end as (vscode.Position & { offset?: number }) | undefined)?.offset
    return state.source.slice(0, offset ?? state.source.length)
  })
  const value = {
    get kind() {
      return state.kind
    },
    document: {
      getText,
      positionAt: (offset: number) => ({ line: 0, character: offset, offset }) as vscode.Position,
      get languageId() {
        return state.language
      },
    },
    get outputs() {
      return state.outputs
    },
    get executionSummary() {
      return state.execution
    },
  } as unknown as vscode.NotebookCell
  return { value, state, getText }
}

function notebook(cells: vscode.NotebookCell[], file = "/repo/book.ipynb"): vscode.NotebookDocument {
  return {
    uri: uri(file),
    version: 1,
    isClosed: false,
    get cellCount() {
      return cells.length
    },
    getCells: () => cells,
    cellAt: (index: number) => cells[index]!,
  } as unknown as vscode.NotebookDocument
}

function harness(document: vscode.NotebookDocument, cells: vscode.NotebookCell[]) {
  const changes = new Set<(event: vscode.NotebookDocumentChangeEvent) => void>()
  const closes = new Set<(document: vscode.NotebookDocument) => void>()
  const calls = {
    open: 0,
    apply: 0,
    command: 0,
    commandArgs: [] as unknown[],
    edit: undefined as unknown,
    write: [] as Array<{ uri: vscode.Uri; content: Uint8Array }>,
  }
  const deps: NotebookAdapterDeps = {
    documents: () => [document],
    open: async () => {
      calls.open++
      return document
    },
    write: async (uri, content) => {
      calls.write.push({ uri, content })
    },
    apply: async (edit) => {
      calls.apply++
      const item = (
        edit as unknown as { edits: Array<{ type: string; index: number; cells?: vscode.NotebookCellData[] }> }
      ).edits[0]!
      if (item.type === "delete") cells.splice(item.index, 1)
      if (item.type !== "delete") {
        const input = (item.cells?.[0] as unknown as { input: NotebookCellInput }).input
        const next = cell(
          input.source,
          input.kind === "code" ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
          input.language ?? (input.kind === "code" ? "plaintext" : "markdown"),
        ).value
        if (item.type === "insert") cells.splice(item.index, 0, next)
        if (item.type === "replace") cells.splice(item.index, 1, next)
      }
      Object.assign(document, { version: document.version + 1 })
      return true
    },
    execute: async (...args) => {
      calls.command++
      calls.commandArgs = args
    },
    change: (listener) => {
      changes.add(listener)
      return { dispose: () => changes.delete(listener) }
    },
    close: (listener) => {
      closes.add(listener)
      return { dispose: () => closes.delete(listener) }
    },
    uri,
    edit: (_uri, edits) => {
      calls.edit = edits
      return { edits } as unknown as vscode.WorkspaceEdit
    },
    insert: (index, items) => ({ type: "insert", index, cells: items }) as unknown as vscode.NotebookEdit,
    replace: (index, items) => ({ type: "replace", index, cells: items }) as unknown as vscode.NotebookEdit,
    delete: (index) => ({ type: "delete", index }) as unknown as vscode.NotebookEdit,
    cell: (input: NotebookCellInput) => ({ input }) as unknown as vscode.NotebookCellData,
  }
  return { deps, changes, closes, calls }
}

const paths = { realpath: async (value: string) => value }
const access = { validateAccess: mock(() => true) }

function adapter(items: ReturnType<typeof cell>[], file = "/repo/book.ipynb", resolver = paths) {
  const cells = items.map((item) => item.value)
  const document = notebook(cells, file)
  const ctx = harness(document, cells)
  return {
    adapter: new NotebookAdapter(access, { deps: ctx.deps, paths: resolver, timeout: 50 }),
    document,
    cells,
    ...ctx,
  }
}

async function revision(core: NotebookAdapter, path = "book.ipynb") {
  return (await core.read({ directory: "/repo", path, includeOutputs: false })).revision
}

function event(document: vscode.NotebookDocument, cell: vscode.NotebookCell, change: object) {
  return {
    notebook: document,
    contentChanges: [],
    cellChanges: [{ cell, ...change }],
  } as unknown as vscode.NotebookDocumentChangeEvent
}

describe("notebook path security", () => {
  it("accepts relative and contained absolute paths and normalizes results", async () => {
    await expect(resolveNotebookPath("/repo", "nested/book.ipynb", access, paths)).resolves.toEqual({
      target: "/repo/nested/book.ipynb",
      relative: "nested/book.ipynb",
    })
    await expect(resolveNotebookPath("/repo", "/repo/nested/book.ipynb", access, paths)).resolves.toEqual({
      target: "/repo/nested/book.ipynb",
      relative: "nested/book.ipynb",
    })
    const ctx = adapter([cell()], "/repo/nested/book.ipynb")
    expect(
      (await ctx.adapter.read({ directory: "/repo", path: "/repo/nested/book.ipynb", includeOutputs: false })).path,
    ).toBe("nested/book.ipynb")
  })

  it("rejects outside absolute paths and relative or absolute symlink escapes", async () => {
    const guard = { validateAccess: mock(() => true) }
    await expect(resolveNotebookPath("/repo", "/outside/secret.ipynb", guard, paths)).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("/outside/secret.ipynb"),
    })
    for (const input of ["linked.ipynb", "/repo/linked.ipynb"]) {
      await expect(
        resolveNotebookPath("/repo", input, guard, {
          realpath: async (value) => (value.endsWith("linked.ipynb") ? "/outside/secret.ipynb" : value),
        }),
      ).rejects.toMatchObject({ code: "invalid_path", message: expect.stringContaining(input) })
    }
    expect(guard.validateAccess).not.toHaveBeenCalled()
  })

  it("enforces ignore access on the canonical target", async () => {
    const guard = { validateAccess: mock(() => false) }
    await expect(resolveNotebookPath("/repo", "book.ipynb", guard, paths)).rejects.toMatchObject({
      code: "invalid_path",
    })
    expect(guard.validateAccess).toHaveBeenCalledWith("/repo/book.ipynb")
  })
})

describe("notebook normalization", () => {
  it("bounds UTF-8 source and text outputs and omits rich bodies", () => {
    expect(normalizeSource("abcdef", 3)).toEqual({ text: "abc", bytes: 6, truncated: true })
    expect(normalizeSource("a€b", 3)).toEqual({ text: "a", bytes: 5, truncated: true })
    const normalized = normalizeOutputs(
      [
        {
          items: [
            { mime: "text/plain", data: new TextEncoder().encode("abcdef") },
            { mime: "image/png", data: new Uint8Array(40) },
          ],
        } as vscode.NotebookCellOutput,
      ],
      3,
    )
    expect(normalized).toEqual({
      outputs: [
        { mime: "text/plain", text: "abc", truncated: true },
        { mime: "image/png", omitted: true },
      ],
      truncated: true,
      bytes: 3,
    })
  })

  it("extracts and bounds standard notebook errors", () => {
    const data = new TextEncoder().encode(
      JSON.stringify({ name: "N".repeat(600), message: "M".repeat(11_000), stack: "trace" }),
    )
    const normalized = normalizeOutputs([
      { items: [{ mime: "application/vnd.code.notebook.error", data }] } as vscode.NotebookCellOutput,
    ])
    expect(normalized.outputs[0]).toMatchObject({ stack: "trace" })
    expect(normalized.outputs[0]?.name).toHaveLength(500)
    expect(normalized.outputs[0]?.message).toHaveLength(10_000)
  })
})

describe("notebook content revisions", () => {
  it("ignores outputs and execution summaries", async () => {
    const item = cell("one")
    const ctx = adapter([item])
    const before = await revision(ctx.adapter)
    item.state.outputs = [{ items: [{ mime: "text/plain", data: new TextEncoder().encode("result") }] } as never]
    item.state.execution = { success: true, executionOrder: 1 }
    expect(await revision(ctx.adapter)).toBe(before)
  })

  it("changes for source, language, kind, insertion, deletion, replacement, and reordering", async () => {
    const first = cell("one")
    const second = cell("two")
    const ctx = adapter([first, second])
    const revisions = [await revision(ctx.adapter)]
    first.state.source = "changed"
    revisions.push(await revision(ctx.adapter))
    first.state.language = "javascript"
    revisions.push(await revision(ctx.adapter))
    first.state.kind = vscode.NotebookCellKind.Markup
    revisions.push(await revision(ctx.adapter))
    const added = cell("added")
    ctx.cells.splice(1, 0, added.value)
    revisions.push(await revision(ctx.adapter))
    ctx.cells.splice(1, 1)
    revisions.push(await revision(ctx.adapter))
    ctx.cells.splice(0, 1, cell("replacement").value)
    revisions.push(await revision(ctx.adapter))
    ctx.cells.reverse()
    revisions.push(await revision(ctx.adapter))
    for (const [index, value] of revisions.entries()) {
      if (index > 0) expect(value).not.toBe(revisions[index - 1])
    }
  })
})

describe("notebook adapter", () => {
  it("prefers an open document and opens missing notebooks in the background", async () => {
    const ctx = adapter([cell("unsaved"), cell("# title", vscode.NotebookCellKind.Markup)])
    const result = await ctx.adapter.read({ directory: "/repo", path: "book.ipynb", includeOutputs: false })
    expect(ctx.calls.open).toBe(0)
    expect(result).toMatchObject({
      path: "book.ipynb",
      cells: [
        { index: 0, kind: "code", language: "python", source: "unsaved" },
        { index: 1, kind: "markdown", language: "markdown", source: "# title" },
      ],
    })
    ctx.deps.documents = () => []
    await ctx.adapter.read({ directory: "/repo", path: "book.ipynb", includeOutputs: false })
    expect(ctx.calls.open).toBe(1)
  })

  it("bounds source reads and skips extraction after the aggregate budget", async () => {
    const items = [
      cell("a".repeat(64 * 1024)),
      cell("b".repeat(64 * 1024)),
      cell("c".repeat(64 * 1024)),
      cell("d".repeat(64 * 1024)),
      cell("ignored"),
    ]
    const ctx = adapter(items)
    const result = await ctx.adapter.read({ directory: "/repo", path: "book.ipynb", includeOutputs: false })

    expect(items[0]!.getText).toHaveBeenCalledTimes(2)
    expect(items[0]!.getText.mock.calls[1]?.[0]).toBeInstanceOf(vscode.Range)
    expect(items[4]!.getText).toHaveBeenCalledTimes(1)
    expect(result.cells[4]?.source).toBe("")
    expect(result.truncated).toBe(true)
  })

  it("chains sequential edits with returned revisions and affected cells", async () => {
    const ctx = adapter([cell("one")])
    const initial = await revision(ctx.adapter)
    const first = await ctx.adapter.edit({
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      expectedRevision: initial,
      edit: { action: "replace", kind: "code", language: "python", source: "two" },
    })
    expect(first.cell).toMatchObject({ index: 0, source: "two" })
    const second = await ctx.adapter.edit({
      directory: "/repo",
      path: "book.ipynb",
      index: 1,
      expectedRevision: first.revision,
      edit: { action: "insert", kind: "markdown", language: "markdown", source: "three" },
    })
    expect(second.revision).not.toBe(first.revision)
    expect(second.cell).toMatchObject({ index: 1, kind: "markdown", source: "three" })
  })

  it("returns a structured stale-revision error for genuine content conflicts", async () => {
    const item = cell("one")
    const ctx = adapter([item])
    const expectedRevision = await revision(ctx.adapter)
    item.state.source = "user edit"
    await expect(
      ctx.adapter.edit({
        directory: "/repo",
        path: "book.ipynb",
        index: 0,
        expectedRevision,
        edit: { action: "delete" },
      }),
    ).rejects.toMatchObject({
      code: "stale_revision",
      path: "book.ipynb",
      index: 0,
      currentRevision: expect.stringContaining("content:"),
      message: expect.stringContaining("Re-read"),
    })
    expect(ctx.calls.apply).toBe(0)
  })

  it("serializes concurrent edits and rejects a stale queued mutation", async () => {
    const ctx = adapter([cell("one")])
    const expectedRevision = await revision(ctx.adapter)
    const first = ctx.adapter.edit({
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      expectedRevision,
      edit: { action: "replace", kind: "code", source: "first" },
    })
    const other = new NotebookAdapter(access, { deps: ctx.deps, paths, timeout: 50 })
    const second = other.edit({
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      expectedRevision,
      edit: { action: "replace", kind: "code", source: "second" },
    })
    const results = await Promise.allSettled([first, second])
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { action: "replace" } })
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "stale_revision" } })
    expect(ctx.cells[0]?.document.getText()).toBe("first")
  })

  it("executes the same target when unrelated cell content or outputs change", async () => {
    const target = cell("target")
    const other = cell("other")
    const ctx = adapter([target, other])
    const expectedRevision = await revision(ctx.adapter)
    other.state.source = "changed elsewhere"
    other.state.outputs = [{ items: [{ mime: "text/plain", data: new TextEncoder().encode("noise") }] } as never]
    ctx.deps.execute = async (...args) => {
      ctx.calls.command++
      ctx.calls.commandArgs = args
      target.state.outputs = [
        { items: [{ mime: "text/plain", data: new TextEncoder().encode("done") }] } as vscode.NotebookCellOutput,
      ]
      target.state.execution = { success: true, executionOrder: 2, timing: { startTime: 10, endTime: 20 } }
      for (const listener of ctx.changes)
        listener(event(ctx.document, target.value, { executionSummary: target.state.execution }))
    }
    const result = await ctx.adapter.execute({
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      expectedRevision,
    })
    expect(result).toMatchObject({ operation: "execute", index: 0, status: "success", outputs: [{ text: "done" }] })
    expect(result.revision).not.toBe(expectedRevision)
    expect(ctx.changes.size).toBe(0)
    expect(ctx.closes.size).toBe(0)
  })

  it("does not authorize another notebook with a cached revision", async () => {
    const first = adapter([cell("target"), cell("first")], "/repo/first.ipynb")
    const expectedRevision = await revision(first.adapter, "first.ipynb")
    const second = adapter([cell("target"), cell("second")], "/repo/second.ipynb")
    await expect(
      second.adapter.execute({
        directory: "/repo",
        path: "second.ipynb",
        index: 0,
        expectedRevision,
      }),
    ).rejects.toMatchObject({ code: "stale_revision", path: "second.ipynb" })
    expect(second.calls.command).toBe(0)
  })

  it("reports an unobserved startup as execution_failed rather than no_kernel", async () => {
    const ctx = adapter([cell()])
    const expectedRevision = await revision(ctx.adapter)
    await expect(
      ctx.adapter.execute({
        directory: "/repo",
        path: "book.ipynb",
        index: 0,
        expectedRevision,
        timeout: 5,
      }),
    ).rejects.toMatchObject({
      code: "execution_failed",
      path: "book.ipynb",
      index: 0,
      message: expect.stringContaining("command was dispatched"),
    })
    expect(ctx.calls.commandArgs).toEqual([
      "notebook.cell.cancelExecution",
      { ranges: [{ start: 0, end: 1 }], document: ctx.document.uri },
    ])
  })

  it("cancels execution and disposes listeners", async () => {
    const ctx = adapter([cell()])
    const expectedRevision = await revision(ctx.adapter)
    const controller = new AbortController()
    const pending = ctx.adapter.execute({
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      expectedRevision,
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "cancelled", path: "book.ipynb", index: 0 })
    expect(ctx.changes.size).toBe(0)
    expect(ctx.closes.size).toBe(0)
  })

  it("rejects execution if the targeted cell changes", async () => {
    const target = cell("before")
    const ctx = adapter([target])
    const expectedRevision = await revision(ctx.adapter)
    ctx.deps.execute = async (...args) => {
      ctx.calls.command++
      ctx.calls.commandArgs = args
      if (args[0] !== "notebook.cell.execute") return
      target.state.source = "after"
      for (const listener of ctx.changes)
        listener(event(ctx.document, target.value, { document: target.value.document }))
    }
    await expect(
      ctx.adapter.execute({ directory: "/repo", path: "book.ipynb", index: 0, expectedRevision }),
    ).rejects.toMatchObject({ code: "stale_revision" })
    expect(ctx.calls.commandArgs).toEqual([
      "notebook.cell.cancelExecution",
      { ranges: [{ start: 0, end: 1 }], document: ctx.document.uri },
    ])
  })
})

describe("notebook create", () => {
  // The new file must not resolve (it does not exist), but its parent directory must.
  const creating = {
    realpath: async (value: string) => (value.endsWith("fresh.ipynb") ? Promise.reject(new Error("ENOENT")) : value),
  }

  it("writes a minimal empty .ipynb, opens it, and returns the initial revision", async () => {
    const ctx = adapter([], "/repo/fresh.ipynb", creating)
    const result = await ctx.adapter.edit({
      directory: "/repo",
      path: "fresh.ipynb",
      index: 0,
      edit: { action: "create" },
    })
    expect(result).toMatchObject({ operation: "edit", action: "create", path: "fresh.ipynb", index: 0 })
    expect(result.revision).toContain("content:")
    expect(ctx.calls.write).toHaveLength(1)
    expect(ctx.calls.open).toBe(1)
    const written = JSON.parse(new TextDecoder().decode(ctx.calls.write[0]!.content))
    expect(written).toMatchObject({ cells: [], nbformat: 4 })
  })

  it("rejects creating a notebook that already exists", async () => {
    const ctx = adapter([cell()], "/repo/book.ipynb")
    await expect(
      ctx.adapter.edit({ directory: "/repo", path: "book.ipynb", index: 0, edit: { action: "create" } }),
    ).rejects.toMatchObject({ code: "already_exists", path: "book.ipynb" })
    expect(ctx.calls.write).toHaveLength(0)
  })

  it("rejects a missing parent directory with not_found", async () => {
    const missing = {
      realpath: async (value: string) => (value === "/repo" ? value : Promise.reject(new Error("ENOENT"))),
    }
    const ctx = adapter([], "/repo/missing/fresh.ipynb", missing)
    await expect(
      ctx.adapter.edit({ directory: "/repo", path: "missing/fresh.ipynb", index: 0, edit: { action: "create" } }),
    ).rejects.toMatchObject({ code: "not_found" })
    expect(ctx.calls.write).toHaveLength(0)
  })

  it("rejects non-.ipynb create targets", async () => {
    const ctx = adapter([], "/repo/notes.txt", creating)
    await expect(
      ctx.adapter.edit({ directory: "/repo", path: "notes.txt", index: 0, edit: { action: "create" } }),
    ).rejects.toMatchObject({ code: "invalid_path" })
    expect(ctx.calls.write).toHaveLength(0)
  })

  it("rejects create targets excluded by access rules", async () => {
    const guard = { validateAccess: mock(() => false) }
    const document = notebook([], "/repo/fresh.ipynb")
    const ctx = harness(document, [])
    const core = new NotebookAdapter(guard, { deps: ctx.deps, paths: creating, timeout: 50 })
    await expect(
      core.edit({ directory: "/repo", path: "fresh.ipynb", index: 0, edit: { action: "create" } }),
    ).rejects.toMatchObject({ code: "invalid_path" })
    expect(ctx.calls.write).toHaveLength(0)
  })
})
