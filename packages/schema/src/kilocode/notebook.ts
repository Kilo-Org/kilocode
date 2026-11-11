export * as KiloNotebook from "./notebook.js"

import { Schema } from "effect"

// The loopback broker contract between the notebook tools in the Kilo server and the VS Code extension that owns
// the live editor state. The extension serves it with a per-run token, so the tools exist only while a
// notebook-capable client is attached. The broker re-validates every path inside the request directory.

const Source = Schema.String.check(Schema.isMaxLength(200_000))
const Text = Schema.String.check(Schema.isMaxLength(100_000))

export const Directory = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)).annotate({
  description: "Absolute directory of the request; it must be an active VS Code workspace or worktree",
})

export const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
  Schema.makeFilter((value: string) =>
    value.includes("\0")
      ? "Notebook path must be a request-directory-relative path or an absolute path inside the request directory"
      : undefined,
  ),
).annotate({
  description:
    "Notebook path relative to the request directory, or an absolute path that resolves inside the request directory",
})
export type Path = Schema.Schema.Type<typeof Path>

export const Revision = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
  description: "Opaque notebook content revision; pass it back unchanged and do not parse or increment it",
})
export type Revision = Schema.Schema.Type<typeof Revision>

const Time = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description: "Zero-based cell index",
})
export type Index = Schema.Schema.Type<typeof Index>

export const Output = Schema.Struct({
  mime: Schema.String.check(Schema.isMaxLength(200)),
  text: Schema.optional(Text),
  name: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(10_000))),
  stack: Schema.optional(Schema.String.check(Schema.isMaxLength(50_000))),
  omitted: Schema.optional(Schema.Boolean),
  truncated: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "NotebookOutput" })
export type Output = Schema.Schema.Type<typeof Output>

export const Cell = Schema.Struct({
  index: Index,
  kind: Schema.Literals(["code", "markdown"]),
  language: Schema.String.check(Schema.isMaxLength(200)),
  source: Source,
  execution: Schema.optional(
    Schema.Struct({
      order: Schema.optional(Index),
      success: Schema.optional(Schema.Boolean),
      started: Schema.optional(Time),
      ended: Schema.optional(Time),
    }),
  ),
  outputs: Schema.optional(Schema.Array(Output).check(Schema.isMaxLength(100))),
}).annotate({ identifier: "NotebookCell" })
export type Cell = Schema.Schema.Type<typeof Cell>

const Base = { directory: Directory, path: Path }

export const ReadRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("read"),
  includeOutputs: Schema.Boolean,
}).annotate({ identifier: "NotebookReadRequest" })

const CellEdit = {
  kind: Schema.Literals(["code", "markdown"]),
  language: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  source: Source,
}

export const EditRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("edit"),
  expectedRevision: Schema.optional(Revision).annotate({
    description: "Required for insert, replace, and delete; omitted for create, which has no prior revision",
  }),
  index: Index,
  edit: Schema.Union([
    Schema.Struct({ action: Schema.Literal("insert"), ...CellEdit }),
    Schema.Struct({ action: Schema.Literal("replace"), ...CellEdit }),
    Schema.Struct({ action: Schema.Literal("delete") }),
    Schema.Struct({ action: Schema.Literal("create") }),
  ]),
}).annotate({ identifier: "NotebookEditRequest" })

export const ExecuteRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("execute"),
  expectedRevision: Revision,
  index: Index,
}).annotate({ identifier: "NotebookExecuteRequest" })

export const Request = Schema.Union([ReadRequest, EditRequest, ExecuteRequest]).annotate({
  identifier: "NotebookRequest",
})
export type Request = Schema.Schema.Type<typeof Request>

export const ReadResult = Schema.Struct({
  operation: Schema.Literal("read"),
  path: Path,
  requestPath: Path,
  revision: Revision,
  cells: Schema.Array(Cell).check(Schema.isMaxLength(2_000)),
  truncated: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "NotebookReadResult" })

export const EditResult = Schema.Struct({
  operation: Schema.Literal("edit"),
  path: Path,
  requestPath: Path,
  revision: Revision,
  index: Index,
  action: Schema.Literals(["insert", "replace", "delete", "create"]),
  cell: Schema.optional(Cell),
}).annotate({ identifier: "NotebookEditResult" })

export const ExecuteResult = Schema.Struct({
  operation: Schema.Literal("execute"),
  path: Path,
  requestPath: Path,
  revision: Revision,
  index: Index,
  status: Schema.Literals(["success", "error"]),
  outputs: Schema.Array(Output).check(Schema.isMaxLength(100)),
  truncated: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "NotebookExecuteResult" })

export const Result = Schema.Union([ReadResult, EditResult, ExecuteResult]).annotate({
  identifier: "NotebookResult",
})
export type Result = Schema.Schema.Type<typeof Result>

export const ErrorCode = Schema.Literals([
  "already_exists",
  "cancelled",
  "closed",
  "disconnected",
  "execution_failed",
  "invalid_cell",
  "invalid_path",
  "no_kernel",
  "not_found",
  "stale_revision",
  "timeout",
  "unsupported",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
  path: Schema.optional(Path),
  index: Schema.optional(Index),
  currentRevision: Schema.optional(Revision),
}).annotate({ identifier: "NotebookFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>

export const Reply = Schema.Union([
  Schema.Struct({ result: Result }),
  Schema.Struct({ error: Failure }),
]).annotate({ identifier: "NotebookReply" })
export type Reply = Schema.Schema.Type<typeof Reply>
