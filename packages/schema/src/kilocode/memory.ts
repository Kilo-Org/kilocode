import { Rpc } from "../rpc.js"
import { Session } from "../session.js"
import { Schema } from "effect"

const sources = ["project.md", "environment.md", "corrections.md"] as const

const stateSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  scope: Schema.Literal("project"),
  autoConsolidate: Schema.Boolean,
})
export type MemoryRpcState = Schema.Schema.Type<typeof stateSchema>

const indexSchema = Schema.Struct({
  text: Schema.String,
  bytes: Schema.Finite,
  tokens: Schema.Finite,
  truncated: Schema.Boolean,
})
export type MemoryRpcIndex = Schema.Schema.Type<typeof indexSchema>

const changeSchema = Schema.Struct({
  operationCount: Schema.Finite,
  added: Schema.Finite,
  removed: Schema.Finite,
  source: Schema.Literals(sources),
  index: indexSchema,
})
export type MemoryRpcChange = Schema.Schema.Type<typeof changeSchema>

const emptyInput = Schema.toStandardSchemaV1(Schema.Struct({}))
const textInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
    key: Schema.optional(Schema.String),
    // The engine's add operation targets a source file and optional section;
    // the original VS Code client authored both per capture.
    file: Schema.optional(Schema.Literals(sources)),
    section: Schema.optional(Schema.String),
    sessionID: Schema.optional(Session.ID),
  }),
)
const queryInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
    sessionID: Schema.optional(Session.ID),
  }),
)
const recallInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
    limit: Schema.optional(Schema.Finite),
  }),
)
const purgeInput = Schema.toStandardSchemaV1(Schema.Struct({ confirm: Schema.Literal(true) }))
const rpcErrors = {
  "kilocode.memory": Schema.toStandardSchemaV1(Schema.Undefined),
}

export const MemoryRpcStatus = Schema.Struct({
  root: Schema.String,
  state: stateSchema,
  exists: Schema.Struct({ state: Schema.Boolean, index: Schema.Boolean }),
  index: indexSchema,
  session: Schema.optional(Schema.Struct({ id: Session.ID, injected: Schema.Boolean })),
  activity: Schema.optional(
    Schema.Struct({
      lastInjectedAt: Schema.NullOr(Schema.Finite),
      lastInjectedBytes: Schema.Finite,
      lastInjectedTokens: Schema.Finite,
      lastSessionSavedAt: Schema.NullOr(Schema.Finite),
      lastTypedConsolidationAt: Schema.NullOr(Schema.Finite),
      lastOperationCount: Schema.Finite,
    }),
  ),
})
export type MemoryRpcStatus = Schema.Schema.Type<typeof MemoryRpcStatus>

export const MemoryRpcShow = Schema.Struct({
  root: Schema.String,
  state: stateSchema,
  sources: Schema.Record(Schema.String, Schema.String),
  index: Schema.String,
  // Stored-memory entries as rendered lines ("key :: text"), the same markers
  // the original client parsed for its stored-memory list.
  items: Schema.optional(Schema.Array(Schema.String)),
})
export type MemoryRpcShow = Schema.Schema.Type<typeof MemoryRpcShow>

export const MemoryRpcRecall = Schema.Struct({
  query: Schema.String,
  hits: Schema.Array(
    Schema.Struct({
      source: Schema.String,
      section: Schema.String,
      key: Schema.String,
      text: Schema.String,
      score: Schema.Finite,
    }),
  ),
  output: Schema.String,
  index: indexSchema,
})
export type MemoryRpcRecall = Schema.Schema.Type<typeof MemoryRpcRecall>

/** Public local-memory RPCs. Every operation runs in the host Location and never admits a session item. */
export namespace MemoryRpc {
  export const Definition = Rpc.define({
    id: "kilocode.memory",
    methods: {
      status: {
        input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.optional(Session.ID) })),
        output: Schema.toStandardSchemaV1(MemoryRpcStatus),
        errors: rpcErrors,
      },
      show: {
        input: emptyInput,
        output: Schema.toStandardSchemaV1(MemoryRpcShow),
        errors: rpcErrors,
      },
      enable: { input: emptyInput, output: Schema.toStandardSchemaV1(stateSchema), errors: rpcErrors },
      disable: { input: emptyInput, output: Schema.toStandardSchemaV1(stateSchema), errors: rpcErrors },
      auto: {
        input: Schema.toStandardSchemaV1(Schema.Struct({ mode: Schema.Literals(["on", "off"]) })),
        output: Schema.toStandardSchemaV1(stateSchema),
        errors: rpcErrors,
      },
      inspect: {
        input: emptyInput,
        output: Schema.toStandardSchemaV1(Schema.Array(Schema.String)),
        errors: rpcErrors,
      },
      rebuild: { input: emptyInput, output: Schema.toStandardSchemaV1(indexSchema), errors: rpcErrors },
      remember: { input: textInput, output: Schema.toStandardSchemaV1(changeSchema), errors: rpcErrors },
      correct: { input: textInput, output: Schema.toStandardSchemaV1(changeSchema), errors: rpcErrors },
      forget: { input: queryInput, output: Schema.toStandardSchemaV1(changeSchema), errors: rpcErrors },
      purge: { input: purgeInput, output: Schema.toStandardSchemaV1(Schema.Boolean), errors: rpcErrors },
      recall: {
        input: recallInput,
        output: Schema.toStandardSchemaV1(MemoryRpcRecall),
        errors: rpcErrors,
      },
    },
    events: {
      // Minimal per-session save attribution for sidebar activity pulses. Carries no
      // content, counts, or paths: those stay on the status/show responses.
      saved: {
        schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      },
    },
  })
}
