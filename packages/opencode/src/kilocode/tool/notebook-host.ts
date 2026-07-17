import { Notebook, HostError } from "@/kilocode/notebook/service"
import { Path, type Result } from "@/kilocode/notebook/protocol"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import * as Tool from "@/tool/tool"
import { Effect, Schema } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { KiloFileGuard } from "@/kilocode/tool/file-guard"

const resolve = (input: string, directory: string) =>
  path.isAbsolute(input) ? path.resolve(input) : path.resolve(directory, input)

const Source = Schema.String.check(Schema.isMaxLength(200_000))
const Revision = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
  description: "Opaque content revision returned by notebook_read or the previous successful notebook_edit",
})
const Index = NonNegativeInt.annotate({ description: "Zero-based cell index" })
const LIMIT = 20_000

function render(value: unknown) {
  const text = JSON.stringify(value, (key, item) => (key === "requestPath" ? undefined : item), 2)
  if (text.length <= LIMIT) return text
  const preview = text.slice(0, 3_000)
  return JSON.stringify(
    {
      truncated: true,
      omittedCharacters: text.length - preview.length,
      preview,
    },
    null,
    2,
  )
}

function abort(signal: AbortSignal) {
  return Effect.callback<never, HostError>((resume) => {
    const err = () => new HostError({ code: "cancelled", detail: "The notebook tool call was cancelled" })
    if (signal.aborted) return resume(Effect.fail(err()))
    const handler = () => resume(Effect.fail(err()))
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

function run(effect: Effect.Effect<Result, HostError>, signal: AbortSignal) {
  return effect.pipe(Effect.raceFirst(abort(signal)), Effect.orDie)
}

const ReadParams = Schema.Struct({
  path: Path,
  include_outputs: Schema.optional(Schema.Boolean).annotate({
    description: "Include bounded text and error outputs. Defaults to false.",
  }),
})

export const NotebookReadTool = Tool.define<
  typeof ReadParams,
  { path: string; revision: string },
  Notebook.Service,
  "notebook_read"
>(
  "notebook_read",
  Effect.gen(function* () {
    const notebook = yield* Notebook.Service
    return {
      description:
        "Read a live, possibly unsaved VS Code notebook using a request-directory-relative path or a safe absolute path inside that directory. Returns an opaque content revision for edits; outputs are omitted unless include_outputs is true. Use notebook_edit to create a notebook or change its cells, and notebook_execute to run a cell and generate its outputs.",
      parameters: ReadParams,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = resolve(params.path, instance.directory)
          const plan = yield* KiloFileGuard.plan({ ctx: instance, requested: filepath, access: "read" }).pipe(
            Effect.orDie,
          )
          yield* ctx.ask({
            permission: "notebook_read",
            patterns: [...new Set([plan.requested, plan.target].map((item) => path.relative(instance.worktree, item)))],
            always: [path.relative(instance.worktree, plan.target)],
            metadata: { path: plan.target, includeOutputs: params.include_outputs === true },
          })
          const target = yield* KiloFileGuard.revalidate({ ctx: instance, plan, access: "read" }).pipe(Effect.orDie)
          const result = yield* run(
            notebook.request({
              operation: "read",
              sessionID: ctx.sessionID,
              path: target.target,
              includeOutputs: params.include_outputs === true,
            }),
            ctx.abort,
          )
          if (result.operation !== "read")
            return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
          return {
            title: `Notebook: ${params.path}`,
            output: render(result),
            metadata: { path: result.path, revision: result.revision },
          }
        }),
    }
  }),
)

const EditParams = Schema.Struct({
  path: Path,
  expected_revision: Schema.optional(Revision).annotate({
    description: "Required for insert, replace, and delete. Omit for create, which has no prior revision.",
  }),
  index: Schema.optional(Index).annotate({
    description: "Zero-based cell index. Required for insert, replace, and delete. Ignored for create.",
  }),
  action: Schema.Literals(["insert", "replace", "delete", "create"]).annotate({
    description:
      "insert and replace require kind and source; delete ignores cell fields; create makes a new empty .ipynb at path and ignores cell fields, index, and expected_revision",
  }),
  kind: Schema.optional(Schema.Literals(["code", "markdown"])).annotate({
    description: "Cell kind. Required for insert and replace.",
  }),
  language: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  source: Schema.optional(Source).annotate({ description: "Cell source. Required for insert and replace." }),
})
type EditInput = Schema.Schema.Type<typeof EditParams>

function cellEdit(params: EditInput) {
  if (params.action === "create") return Effect.succeed({ action: params.action } as const)
  if (params.action === "delete") {
    if (params.expected_revision === undefined || params.index === undefined)
      return Effect.die(
        new Tool.InvalidArgumentsError({
          tool: "notebook_edit",
          detail: `the "delete" action requires both "expected_revision" and "index"`,
        }),
      )
    return Effect.succeed({ action: params.action } as const)
  }
  if (
    params.kind === undefined ||
    params.source === undefined ||
    params.expected_revision === undefined ||
    params.index === undefined
  )
    return Effect.die(
      new Tool.InvalidArgumentsError({
        tool: "notebook_edit",
        detail: `the "${params.action}" action requires "kind", "source", "expected_revision", and "index"`,
      }),
    )
  return Effect.succeed({
    action: params.action,
    kind: params.kind,
    language: params.language,
    source: params.source,
  })
}

export const NotebookEditTool = Tool.define<
  typeof EditParams,
  { path: string; revision: string; index: number },
  Notebook.Service,
  "notebook_edit"
>(
  "notebook_edit",
  Effect.gen(function* () {
    const notebook = yield* Notebook.Service
    return {
      description:
        "Insert, replace, delete, or create cells in a live VS Code notebook. To build a notebook from scratch, do not hand-write a .ipynb file: call this tool with action create, then insert cells one at a time, then run them with notebook_execute. Cell outputs are produced only by notebook_execute; never author outputs yourself. insert/replace/delete operate on one cell and require expected_revision and index. create makes a new empty .ipynb at path (the parent directory must exist) and returns its initial revision so you can then insert cells. Paths may be request-directory-relative or safe absolute paths. Pass the latest opaque revision from notebook_read or the previous successful edit unchanged. A stale_revision error requires a fresh read; never blindly retry an index-based edit. Leaves the document dirty.",
      parameters: EditParams,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = resolve(params.path, instance.directory)
          const plan = yield* KiloFileGuard.plan({ ctx: instance, requested: filepath }).pipe(Effect.orDie)
          const edit = yield* cellEdit(params)
          const index = params.action === "create" ? 0 : params.index!
          yield* ctx.ask({
            permission: "notebook_edit",
            patterns: [...new Set([plan.requested, plan.target].map((item) => path.relative(instance.worktree, item)))],
            always: [path.relative(instance.worktree, plan.target)],
            metadata: {
              path: plan.target,
              action: params.action,
              index,
              expectedRevision: params.expected_revision,
            },
          })
          const target = yield* KiloFileGuard.revalidate({ ctx: instance, plan }).pipe(Effect.orDie)
          const result = yield* run(
            notebook.request({
              operation: "edit",
              sessionID: ctx.sessionID,
              path: target.target,
              ...(params.expected_revision !== undefined ? { expectedRevision: params.expected_revision } : {}),
              index,
              edit,
            }),
            ctx.abort,
          )
          if (result.operation !== "edit")
            return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
          return {
            title:
              result.action === "create"
                ? `created notebook ${result.path}`
                : `${result.action} notebook cell ${result.index}`,
            output: render(result),
            metadata: { path: result.path, revision: result.revision, index: result.index },
          }
        }),
    }
  }),
)

const ExecuteParams = Schema.Struct({ path: Path, expected_revision: Revision, index: Index })

export const NotebookExecuteTool = Tool.define<
  typeof ExecuteParams,
  { path: string; revision: string; index: number },
  Notebook.Service,
  "notebook_execute"
>(
  "notebook_execute",
  Effect.gen(function* () {
    const notebook = yield* Notebook.Service
    return {
      description:
        "Execute one explicit code cell in a live VS Code notebook using a request-directory-relative or safe absolute path. Pass the latest opaque content revision unchanged. Execution requires a kernel already selected by the user; the tool never reveals the notebook or opens a kernel picker.",
      parameters: ExecuteParams,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = resolve(params.path, instance.directory)
          const plan = yield* KiloFileGuard.plan({ ctx: instance, requested: filepath, access: "read" }).pipe(
            Effect.orDie,
          )
          yield* ctx.ask({
            permission: "notebook_execute",
            patterns: [...new Set([plan.requested, plan.target].map((item) => path.relative(instance.worktree, item)))],
            always: [path.relative(instance.worktree, plan.target)],
            metadata: { path: plan.target, index: params.index, expectedRevision: params.expected_revision },
          })
          const target = yield* KiloFileGuard.revalidate({ ctx: instance, plan, access: "read" }).pipe(Effect.orDie)
          const result = yield* run(
            notebook.request({
              operation: "execute",
              sessionID: ctx.sessionID,
              path: target.target,
              expectedRevision: params.expected_revision,
              index: params.index,
            }),
            ctx.abort,
          )
          if (result.operation !== "execute")
            return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
          return {
            title: `Executed notebook cell ${result.index}`,
            output: render(result),
            metadata: { path: result.path, revision: result.revision, index: result.index },
          }
        }),
    }
  }),
)
