import type { AssertInput } from "@opencode/plugin/permission"
import { KiloNotebook } from "@opencode/schema/kilocode/notebook"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { send, type Endpoint } from "./broker"
import EDIT from "./notebook-edit.txt"
import EXECUTE from "./notebook-execute.txt"
import READ from "./notebook-read.txt"

const LIMIT = 20_000

export interface Runtime {
  readonly endpoint: Endpoint
  readonly directory: string
  readonly permission: { readonly assert: (input: AssertInput) => Effect.Effect<void, unknown> }
}

/** The model-visible body. `requestPath` repeats the input path, so it is dropped before rendering. */
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

const Parameters = Schema.Struct({
  path: KiloNotebook.Path,
  include_outputs: Schema.optional(Schema.Boolean).annotate({
    description: "Include bounded text and error outputs. Defaults to false.",
  }),
})

const EditParameters = Schema.Struct({
  path: KiloNotebook.Path,
  expected_revision: Schema.optional(KiloNotebook.Revision).annotate({
    description: "Required for insert, replace, and delete. Omit for create, which has no prior revision.",
  }),
  index: Schema.optional(KiloNotebook.Index).annotate({
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
  source: Schema.optional(Schema.String.check(Schema.isMaxLength(200_000))).annotate({
    description: "Cell source. Required for insert and replace.",
  }),
})

const ExecuteParameters = Schema.Struct({
  path: KiloNotebook.Path,
  expected_revision: KiloNotebook.Revision,
  index: KiloNotebook.Index,
})

const Text = Schema.String

type EditInput = Schema.Schema.Type<typeof EditParameters>
type Edit = Extract<KiloNotebook.Request, { operation: "edit" }>["edit"]

function cellEdit(params: EditInput): Effect.Effect<Edit, Tool.Error> {
  if (params.action === "create") return Effect.succeed({ action: params.action })
  if (params.action === "delete") {
    if (params.expected_revision === undefined || params.index === undefined)
      return Effect.fail(
        new Tool.Error({ message: 'the "delete" action requires both "expected_revision" and "index"' }),
      )
    return Effect.succeed({ action: params.action })
  }
  if (
    params.kind === undefined ||
    params.source === undefined ||
    params.expected_revision === undefined ||
    params.index === undefined
  )
    return Effect.fail(
      new Tool.Error({
        message: `the "${params.action}" action requires "kind", "source", "expected_revision", and "index"`,
      }),
    )
  return Effect.succeed({
    action: params.action,
    kind: params.kind,
    ...(params.language === undefined ? {} : { language: params.language }),
    source: params.source,
  })
}

function ask(runtime: Runtime, context: Tool.Context, action: string, resource: string, metadata: Record<string, unknown>) {
  return runtime.permission
    .assert({
      sessionID: context.sessionID,
      agent: context.agent,
      action,
      resources: [resource],
      save: [resource],
      metadata,
      source: { type: "tool", messageID: context.messageID, id: context.id },
    })
    .pipe(
      Effect.mapError((error) =>
        new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
      ),
    )
}

function failure(error: KiloNotebook.Failure) {
  return new Tool.Error({
    message: `${error.code}: ${error.message}`,
    metadata: {
      code: error.code,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.index === undefined ? {} : { index: error.index }),
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    },
  })
}

function call(runtime: Runtime, request: KiloNotebook.Request) {
  return Effect.tryPromise({
    try: (signal) => send({ endpoint: runtime.endpoint, request, signal }),
    catch: (cause) =>
      new Tool.Error({
        message: `The notebook host could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
        metadata: { code: "disconnected" },
      }),
  })
}

function result(reply: KiloNotebook.Reply) {
  return "error" in reply ? Effect.fail(failure(reply.error)) : Effect.succeed(reply.result)
}

export function makeTools(runtime: Runtime) {
  const read: Tool.Info<typeof Parameters, typeof Text> = {
    name: "notebook_read",
    description: READ,
    input: Parameters,
    output: Text,
    options: { codemode: false },
    execute: (params, context) =>
      Effect.gen(function* () {
        yield* ask(runtime, context, "notebook_read", params.path, {
          path: params.path,
          includeOutputs: params.include_outputs === true,
        })
        const value = yield* result(
          yield* call(runtime, {
            operation: "read",
            directory: runtime.directory,
            path: params.path,
            includeOutputs: params.include_outputs === true,
          }),
        )
        if (value.operation !== "read") return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
        return {
          output: render(value),
          metadata: { path: value.path, revision: value.revision },
        }
      }),
  }

  const edit: Tool.Info<typeof EditParameters, typeof Text> = {
    name: "notebook_edit",
    description: EDIT,
    input: EditParameters,
    output: Text,
    options: { codemode: false },
    execute: (params, context) =>
      Effect.gen(function* () {
        const change = yield* cellEdit(params)
        const index = params.action === "create" ? 0 : params.index!
        yield* ask(runtime, context, "notebook_edit", params.path, {
          path: params.path,
          action: params.action,
          index,
          expectedRevision: params.expected_revision,
        })
        const value = yield* result(
          yield* call(runtime, {
            operation: "edit",
            directory: runtime.directory,
            path: params.path,
            ...(params.expected_revision === undefined ? {} : { expectedRevision: params.expected_revision }),
            index,
            edit: change,
          }),
        )
        if (value.operation !== "edit") return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
        return {
          output: render(value),
          metadata: { path: value.path, revision: value.revision, index: value.index },
        }
      }),
  }

  const execute: Tool.Info<typeof ExecuteParameters, typeof Text> = {
    name: "notebook_execute",
    description: EXECUTE,
    input: ExecuteParameters,
    output: Text,
    options: { codemode: false },
    execute: (params, context) =>
      Effect.gen(function* () {
        yield* ask(runtime, context, "notebook_execute", params.path, {
          path: params.path,
          index: params.index,
          expectedRevision: params.expected_revision,
        })
        const value = yield* result(
          yield* call(runtime, {
            operation: "execute",
            directory: runtime.directory,
            path: params.path,
            expectedRevision: params.expected_revision,
            index: params.index,
          }),
        )
        if (value.operation !== "execute")
          return yield* Effect.die(new Error("Notebook host returned the wrong result type"))
        return {
          output: render(value),
          metadata: { path: value.path, revision: value.revision, index: value.index },
        }
      }),
  }

  return { read, edit, execute }
}
