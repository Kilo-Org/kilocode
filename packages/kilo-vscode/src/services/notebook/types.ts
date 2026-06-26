import type * as vscode from "vscode"

export const NOTEBOOK_LIMITS = {
  source: 64 * 1024,
  sources: 256 * 1024,
  item: 16 * 1024,
  output: 64 * 1024,
  outputs: 256 * 1024,
} as const

export type NotebookCellKind = "code" | "markdown"

export interface NotebookText {
  text: string
  bytes: number
  truncated?: true
}

export interface NotebookOutput {
  mime: string
  text?: string
  name?: string
  message?: string
  stack?: string
  omitted?: boolean
  truncated?: boolean
}

export interface NotebookExecution {
  order?: number
  success?: boolean
  started?: number
  ended?: number
}

export interface NotebookCell {
  index: number
  kind: NotebookCellKind
  language: string
  source: string
  execution?: NotebookExecution
  outputs?: NotebookOutput[]
}

export interface NotebookReadResult {
  operation: "read"
  path: string
  requestPath: string
  revision: string
  cells: NotebookCell[]
  truncated?: boolean
}

export interface NotebookEditResult {
  operation: "edit"
  path: string
  requestPath: string
  revision: string
  index: number
  action: "insert" | "replace" | "delete" | "create"
  cell?: NotebookCell
}

export interface NotebookExecuteResult {
  operation: "execute"
  path: string
  requestPath: string
  revision: string
  index: number
  status: "success" | "error"
  outputs: NotebookOutput[]
  truncated?: boolean
}

export interface NotebookCellInput {
  kind: NotebookCellKind
  language?: string
  source: string
}

export type NotebookEdit =
  | ({ action: "insert" } & NotebookCellInput)
  | ({ action: "replace" } & NotebookCellInput)
  | { action: "delete" }
  | { action: "create" }

export interface NotebookReadRequest {
  path: string
  directory: string
  includeOutputs: boolean
}

export interface NotebookEditRequest {
  path: string
  directory: string
  expectedRevision?: string
  index: number
  edit: NotebookEdit
}

export interface NotebookExecuteRequest {
  path: string
  directory: string
  expectedRevision: string
  index: number
  signal?: AbortSignal
  timeout?: number
}

export interface NotebookAccess {
  validateAccess(path: string): boolean | Promise<boolean>
}

export interface NotebookAdapterDeps {
  documents(): readonly vscode.NotebookDocument[]
  open(uri: vscode.Uri): Promise<vscode.NotebookDocument>
  write(uri: vscode.Uri, content: Uint8Array): Promise<void>
  apply(edit: vscode.WorkspaceEdit): Promise<boolean>
  execute(command: string, ...args: unknown[]): Promise<unknown>
  change(listener: (event: vscode.NotebookDocumentChangeEvent) => void): vscode.Disposable
  close(listener: (document: vscode.NotebookDocument) => void): vscode.Disposable
  uri(path: string): vscode.Uri
  edit(uri: vscode.Uri, edits: vscode.NotebookEdit[]): vscode.WorkspaceEdit
  insert(index: number, cells: vscode.NotebookCellData[]): vscode.NotebookEdit
  replace(index: number, cells: vscode.NotebookCellData[]): vscode.NotebookEdit
  delete(index: number): vscode.NotebookEdit
  cell(input: NotebookCellInput): vscode.NotebookCellData
}
