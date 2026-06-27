import path from "node:path"
import * as vscode from "vscode"
import { normalizeOutputs, normalizeSource } from "./output"
import { NotebookError, resolveNotebookCreatePath, resolveNotebookPath, type NotebookPathDeps } from "./path"
import { cellFingerprint, fingerprint, notebookState, sameCell, type NotebookState } from "./revision"
import {
  NOTEBOOK_LIMITS,
  type NotebookAccess,
  type NotebookAdapterDeps,
  type NotebookCell,
  type NotebookEditRequest,
  type NotebookEditResult,
  type NotebookExecuteRequest,
  type NotebookExecuteResult,
  type NotebookExecution,
  type NotebookReadRequest,
  type NotebookReadResult,
} from "./types"

const RETAINED_REVISIONS = 1_000
const revisions = new Map<string, NotebookState>()
const locks = new Map<string, Promise<void>>()

// Minimal valid empty Jupyter notebook accepted by the built-in ipynb serializer.
const EMPTY_IPYNB = JSON.stringify(
  {
    cells: [],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  1,
)

function revisionKey(target: string, revision: string): string {
  return `${target}\0${revision}`
}

export interface NotebookAdapterOptions {
  deps?: NotebookAdapterDeps
  paths?: NotebookPathDeps
  timeout?: number
}

function execution(summary: vscode.NotebookCellExecutionSummary | undefined): NotebookExecution | undefined {
  if (!summary) {
    return undefined
  }
  return {
    order: summary.executionOrder,
    success: summary.success,
    started: summary.timing?.startTime,
    ended: summary.timing?.endTime,
  }
}

function changed(
  base: vscode.NotebookCellExecutionSummary | undefined,
  summary: vscode.NotebookCellExecutionSummary | undefined,
): boolean {
  if (!summary) return false
  return (
    summary.executionOrder !== base?.executionOrder ||
    summary.success !== base?.success ||
    summary.timing?.startTime !== base?.timing?.startTime ||
    summary.timing?.endTime !== base?.timing?.endTime
  )
}

function defaults(): NotebookAdapterDeps {
  return {
    documents: () => vscode.workspace.notebookDocuments,
    open: (uri) => Promise.resolve(vscode.workspace.openNotebookDocument(uri)),
    write: (uri, content) => Promise.resolve(vscode.workspace.fs.writeFile(uri, content)),
    apply: (edit) => Promise.resolve(vscode.workspace.applyEdit(edit)),
    execute: (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    change: (listener) => vscode.workspace.onDidChangeNotebookDocument(listener),
    close: (listener) => vscode.workspace.onDidCloseNotebookDocument(listener),
    uri: vscode.Uri.file,
    edit: (uri, edits) => {
      const edit = new vscode.WorkspaceEdit()
      edit.set(uri, edits)
      return edit
    },
    insert: (index, cells) => vscode.NotebookEdit.insertCells(index, cells),
    replace: (index, cells) => vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(index, index + 1), cells),
    delete: (index) => vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(index, index + 1)),
    cell: (input) =>
      new vscode.NotebookCellData(
        input.kind === "code" ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
        input.source,
        input.language ?? (input.kind === "code" ? "plaintext" : "markdown"),
      ),
  }
}

export class NotebookAdapter {
  private readonly deps: NotebookAdapterDeps
  private readonly timeout: number

  constructor(
    private readonly access: NotebookAccess,
    private readonly options: NotebookAdapterOptions = {},
  ) {
    this.deps = options.deps ?? defaults()
    this.timeout = options.timeout ?? 9 * 60_000
  }

  private async document(
    directory: string,
    input: string,
  ): Promise<{ document: vscode.NotebookDocument; path: string; target: string }> {
    const resolved = await resolveNotebookPath(directory, input, this.access, this.options.paths)
    const open = this.deps
      .documents()
      .find((document) => path.resolve(document.uri.fsPath) === path.resolve(resolved.target))
    const document = open ?? (await this.deps.open(this.deps.uri(resolved.target)))
    if (document.isClosed) {
      throw new NotebookError("closed", `Notebook ${JSON.stringify(resolved.relative)} is closed`, {
        path: resolved.relative,
      })
    }
    return { document, path: resolved.relative, target: resolved.target }
  }

  async read(request: NotebookReadRequest): Promise<NotebookReadResult> {
    const loaded = await this.document(request.directory, request.path)
    const cells: NotebookCell[] = []
    const budget = { sources: 0, outputs: 0 }
    const flags = { sources: false, outputs: false }

    const items = loaded.document.getCells()
    const state = this.remember(loaded.document, loaded.target)
    if (items.length > 2_000) {
      flags.sources = true
    }
    for (const [index, cell] of items.slice(0, 2_000).entries()) {
      const limit = Math.max(0, Math.min(NOTEBOOK_LIMITS.source, NOTEBOOK_LIMITS.sources - budget.sources))
      const source = (() => {
        if (limit === 0) {
          flags.sources = true
          return { text: "", bytes: 0 }
        }
        const end = cell.document.positionAt(limit + 2)
        const range = new vscode.Range(new vscode.Position(0, 0), end)
        return normalizeSource(cell.document.getText(range), limit)
      })()
      budget.sources += source.bytes
      flags.sources ||= source.truncated === true
      const value: NotebookCell = {
        index,
        kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
        language: cell.document.languageId.slice(0, 200),
        source: source.text,
        execution: execution(cell.executionSummary),
      }
      if (request.includeOutputs) {
        const normalized = normalizeOutputs(
          cell.outputs,
          Math.max(0, Math.min(NOTEBOOK_LIMITS.output, NOTEBOOK_LIMITS.outputs - budget.outputs)),
        )
        value.outputs = normalized.outputs
        budget.outputs += normalized.bytes
        if (normalized.truncated) {
          flags.outputs = true
        }
      }
      cells.push(value)
    }

    return {
      operation: "read",
      path: loaded.path,
      requestPath: request.path,
      revision: state.revision,
      cells,
      ...(flags.sources || flags.outputs ? { truncated: true } : {}),
    }
  }

  async edit(request: NotebookEditRequest): Promise<NotebookEditResult> {
    const edit = request.edit
    if (edit.action === "create") {
      return this.create(request)
    }
    const loaded = await this.document(request.directory, request.path)
    return this.lock(loaded.target, async () => {
      const before = this.remember(loaded.document, loaded.target)
      const expectedRevision = request.expectedRevision
      if (expectedRevision === undefined) {
        throw new NotebookError("invalid_cell", "An expected revision is required for this edit", {
          path: loaded.path,
          index: request.index,
        })
      }
      this.revision(before, expectedRevision, loaded.path, request.index)
      const count = loaded.document.cellCount
      const max = edit.action === "insert" ? count : count - 1
      if (!Number.isInteger(request.index) || request.index < 0 || request.index > max) {
        throw new NotebookError("invalid_cell", `Cell index ${request.index} is out of range`, {
          path: loaded.path,
          index: request.index,
        })
      }

      const expected = [...before.cells]
      const edits = (() => {
        if (edit.action === "delete") {
          expected.splice(request.index, 1)
          return [this.deps.delete(request.index)]
        }
        const language = edit.language ?? (edit.kind === "code" ? "plaintext" : "markdown")
        const cell = this.deps.cell({
          kind: edit.kind,
          language: edit.language,
          source: edit.source,
        })
        const value = fingerprint(edit.kind, language, edit.source)
        if (edit.action === "insert") {
          expected.splice(request.index, 0, value)
          return [this.deps.insert(request.index, [cell])]
        }
        expected.splice(request.index, 1, value)
        return [this.deps.replace(request.index, [cell])]
      })()
      this.revision(this.remember(loaded.document, loaded.target), expectedRevision, loaded.path, request.index)
      if (!(await this.deps.apply(this.deps.edit(loaded.document.uri, edits)))) {
        throw new NotebookError("unsupported", "VS Code rejected the notebook edit", {
          path: loaded.path,
          index: request.index,
        })
      }
      const after = this.remember(loaded.document, loaded.target)
      if (after.cells.length !== expected.length || after.cells.some((value, index) => value !== expected[index])) {
        throw this.stale(loaded.path, request.index, after.revision, "Notebook content changed while applying the edit")
      }
      const result: NotebookEditResult = {
        operation: "edit",
        path: loaded.path,
        requestPath: request.path,
        revision: after.revision,
        index: request.index,
        action: edit.action,
      }
      if (edit.action !== "delete" && request.index < loaded.document.cellCount) {
        result.cell = this.cell(loaded.document.cellAt(request.index), request.index)
      }
      return result
    })
  }

  private async create(request: NotebookEditRequest): Promise<NotebookEditResult> {
    const resolved = await resolveNotebookCreatePath(request.directory, request.path, this.access, this.options.paths)
    return this.lock(resolved.target, async () => {
      await this.deps.write(this.deps.uri(resolved.target), new TextEncoder().encode(EMPTY_IPYNB))
      const document = await this.deps.open(this.deps.uri(resolved.target))
      if (document.isClosed) {
        throw new NotebookError("closed", `Notebook ${JSON.stringify(resolved.relative)} is closed`, {
          path: resolved.relative,
        })
      }
      const state = this.remember(document, resolved.target)
      return {
        operation: "edit",
        path: resolved.relative,
        requestPath: request.path,
        revision: state.revision,
        index: 0,
        action: "create",
      }
    })
  }

  async execute(request: NotebookExecuteRequest): Promise<NotebookExecuteResult> {
    const loaded = await this.document(request.directory, request.path)
    const state = this.remember(loaded.document, loaded.target)
    if (!Number.isInteger(request.index) || request.index < 0 || request.index >= loaded.document.cellCount) {
      throw new NotebookError("invalid_cell", `Cell index ${request.index} is out of range`, {
        path: loaded.path,
        index: request.index,
      })
    }
    const expected = revisions.get(revisionKey(loaded.target, request.expectedRevision))
    if (
      state.revision !== request.expectedRevision &&
      !sameCell(expected?.cells[request.index], state.cells[request.index])
    ) {
      throw this.stale(loaded.path, request.index, state.revision, "The targeted notebook cell changed")
    }
    const cell = loaded.document.cellAt(request.index)
    if (cell.kind !== vscode.NotebookCellKind.Code) {
      throw new NotebookError("invalid_cell", `Cell ${request.index} is not a code cell`, {
        path: loaded.path,
        index: request.index,
      })
    }

    const result = this.wait(loaded.document, cell, loaded.target, loaded.path, state.cells[request.index]!, request)
    void this.deps
      .execute("notebook.cell.execute", {
        ranges: [{ start: request.index, end: request.index + 1 }],
        document: loaded.document.uri,
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        result.reject(
          new NotebookError("execution_failed", `Notebook execution could not start: ${detail}`, {
            path: loaded.path,
            index: request.index,
          }),
        )
      })
    return result.promise
  }

  private wait(
    document: vscode.NotebookDocument,
    cell: vscode.NotebookCell,
    target: string,
    path: string,
    fingerprint: NotebookState["cells"][number],
    request: NotebookExecuteRequest,
  ) {
    const state: {
      done: boolean
      timer?: ReturnType<typeof setTimeout>
      startup?: ReturnType<typeof setTimeout>
    } = { done: false }
    const base = cell.executionSummary
    const disposables: vscode.Disposable[] = []
    const cleanup = () => {
      if (state.done) {
        return false
      }
      state.done = true
      if (state.timer) {
        clearTimeout(state.timer)
      }
      if (state.startup) {
        clearTimeout(state.startup)
      }
      for (const disposable of disposables) {
        disposable.dispose()
      }
      request.signal?.removeEventListener("abort", abort)
      return true
    }
    const holder: {
      resolve?: (value: NotebookExecuteResult) => void
      reject?: (error: Error) => void
    } = {}
    const promise = new Promise<NotebookExecuteResult>((resolve, reject) => {
      holder.resolve = resolve
      holder.reject = reject
    })
    const reject = (error: Error) => {
      if (cleanup()) {
        holder.reject?.(error)
      }
    }
    const resolve = () => {
      if (!cleanup()) {
        return
      }
      const normalized = normalizeOutputs(cell.outputs)
      holder.resolve?.({
        operation: "execute",
        path,
        requestPath: request.path,
        revision: this.remember(document, target).revision,
        index: request.index,
        status: cell.executionSummary?.success === false ? "error" : "success",
        outputs: normalized.outputs,
        ...(normalized.truncated ? { truncated: true } : {}),
      })
    }
    const stop = () =>
      void this.deps.execute("notebook.cell.cancelExecution", {
        ranges: [{ start: request.index, end: request.index + 1 }],
        document: document.uri,
      })
    const abort = () => {
      stop()
      reject(
        new NotebookError("cancelled", "Notebook execution cancellation was requested", {
          path,
          index: request.index,
        }),
      )
    }

    disposables.push(
      this.deps.change((event) => {
        if (event.notebook !== document) {
          return
        }
        const live = document.cellCount > request.index ? cellFingerprint(document.cellAt(request.index)) : undefined
        if (
          document.isClosed ||
          document.cellCount <= request.index ||
          document.cellAt(request.index) !== cell ||
          !sameCell(fingerprint, live)
        ) {
          const current = this.remember(document, target)
          reject(
            this.stale(path, request.index, current.revision, "The targeted notebook cell changed during execution"),
          )
          stop()
          return
        }
        const change = event.cellChanges.find((item) => item.cell === cell)
        if (!change) {
          return
        }
        if (state.startup && (change.outputs !== undefined || change.executionSummary !== undefined)) {
          clearTimeout(state.startup)
          state.startup = undefined
        }
        const summary = change.executionSummary
        if (!summary || !changed(base, summary)) return
        if (summary.success !== undefined || summary.timing?.endTime !== undefined) resolve()
      }),
      this.deps.close((closed) => {
        if (closed === document) {
          reject(new NotebookError("closed", "Notebook closed during execution", { path, index: request.index }))
        }
      }),
    )
    const timeout = request.timeout ?? this.timeout
    state.startup = setTimeout(
      () => {
        stop()
        reject(
          new NotebookError(
            "execution_failed",
            "The execution command was dispatched, but VS Code reported no execution activity before the startup timeout. Ensure a kernel is selected and try again",
            { path, index: request.index },
          ),
        )
      },
      Math.min(timeout, 60_000),
    )
    state.timer = setTimeout(() => {
      stop()
      reject(new NotebookError("timeout", "Notebook execution timed out", { path, index: request.index }))
    }, timeout)
    if (request.signal?.aborted) {
      abort()
    } else {
      request.signal?.addEventListener("abort", abort, { once: true })
    }
    return { promise, reject }
  }

  private cell(cell: vscode.NotebookCell, index: number): NotebookCell {
    return {
      index,
      kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
      language: cell.document.languageId.slice(0, 200),
      source: cell.document.getText().slice(0, 200_000),
      execution: execution(cell.executionSummary),
    }
  }

  private remember(document: vscode.NotebookDocument, target: string): NotebookState {
    const state = notebookState(document)
    const key = revisionKey(target, state.revision)
    revisions.delete(key)
    revisions.set(key, state)
    if (revisions.size > RETAINED_REVISIONS) {
      const oldest = revisions.keys().next().value
      if (oldest !== undefined) revisions.delete(oldest)
    }
    return state
  }

  private revision(state: NotebookState, expected: string, path: string, index: number): void {
    if (state.revision !== expected) {
      throw this.stale(path, index, state.revision, "Notebook content changed")
    }
  }

  private stale(path: string, index: number, revision: string, detail: string): NotebookError {
    return new NotebookError(
      "stale_revision",
      `${detail}. Re-read ${JSON.stringify(path)} before retrying; do not blindly replay an index-based edit`,
      { path, index, currentRevision: revision },
    )
  }

  private async lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = locks.get(key) ?? Promise.resolve()
    const gate: { release?: () => void } = {}
    const current = new Promise<void>((resolve) => (gate.release = resolve))
    const next = prior.then(() => current)
    locks.set(key, next)
    await prior
    try {
      return await task()
    } finally {
      gate.release?.()
      if (locks.get(key) === next) locks.delete(key)
    }
  }
}
