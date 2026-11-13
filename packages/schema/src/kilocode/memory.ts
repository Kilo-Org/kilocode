export * as KiloMemoryRpc from "./memory.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

// The `kilocode.memory` RPC contract: project memory status, inspection, settings and explicit writes of a location.
// The memory plugin in packages/kilo-plugin registers the handlers; clients import this contract from
// `@opencode/schema/kilocode/memory`. The memory store itself lives in `@kilocode/kilo-memory`.
const portable = Schema.toStandardSchemaV1

export const Sources = ["project.md", "environment.md", "corrections.md"] as const
export const Source = Schema.Literals(Sources)
export type Source = typeof Source.Type

/** The reason of a `memory.error` event for a suppressible background capture failure. Clients do not toast it. */
export const TRANSIENT = "transient"

const Count = Schema.Finite
const Stamp = Schema.NullOr(Schema.Finite)

export const Capture = Schema.Struct({
  mode: Schema.Literal("selective"),
  turnClose: Schema.Boolean,
  explicit: Schema.Boolean,
  maxOpsPerRun: Count,
  minIntervalMs: Count,
  timeoutMs: Count,
})

export const Limits = Schema.Struct({
  maxProjectIndexBytes: Count,
  maxSessionFiles: Count,
  maxRecentSessions: Count,
  maxConsolidationInputBytes: Count,
  maxLineChars: Count,
  maxSessionLineChars: Count,
})

export const Stats = Schema.Struct({
  lastInjectedAt: Stamp,
  lastInjectedBytes: Count,
  lastInjectedTokens: Count,
  lastInjectedSessionID: Schema.NullOr(Schema.String),
  lastTypedConsolidationAt: Stamp,
  lastSessionSavedAt: Stamp,
  lastConsolidatedMessageID: Schema.NullOr(Schema.String),
  lastConsolidationCost: Count,
  lastConsolidationTokens: Count,
  lastOperationCount: Count,
  lastRecallAt: Stamp,
  lastRecallCount: Count,
  lastRecallSessionID: Schema.NullOr(Schema.String),
})

export const State = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  scope: Schema.Literal("project"),
  autoInject: Schema.Boolean,
  autoConsolidate: Schema.Boolean,
  verbose: Schema.Boolean,
  capture: Capture,
  limits: Limits,
  stats: Stats,
}).annotate({ identifier: "MemoryState" })
export type State = typeof State.Type

export const Index = Schema.Struct({
  text: Schema.String,
  bytes: Count,
  tokens: Count,
  truncated: Schema.Boolean,
})
export type Index = typeof Index.Type

/** Memory the model saw in one session: the injected startup index or the latest targeted recall. */
export const Marker = Schema.Struct({
  type: Schema.Literals(["startup", "recall"]),
  tokens: Count,
  count: Count,
  files: Schema.Array(Schema.String),
  items: Schema.optional(Schema.Array(Schema.String)),
})
export type Marker = typeof Marker.Type

export const Status = Schema.Struct({
  /** The memory folder of the project. */
  root: Schema.String,
  state: State,
  exists: Schema.Struct({ state: Schema.Boolean, index: Schema.Boolean }),
  index: Schema.Struct({ bytes: Count, estimatedTokens: Count, preview: Schema.String }),
  /** Memory the requested session used, when `sessionID` was given and the session used memory. */
  marker: Schema.optional(Marker),
}).annotate({ identifier: "MemoryStatus" })
export type Status = typeof Status.Type

export const Show = Schema.Struct({
  root: Schema.String,
  state: State,
  sources: Schema.Struct({ project: Schema.String, environment: Schema.String, corrections: Schema.String }),
  index: Schema.String,
  /** Readable inventory of the stored records. */
  items: Schema.String,
}).annotate({ identifier: "MemoryShow" })
export type Show = typeof Show.Type

export const Changed = Schema.Struct({ root: Schema.String, state: State, index: Index })
export type Changed = typeof Changed.Type

export const Settings = Schema.Struct({ root: Schema.String, state: State })
export type Settings = typeof Settings.Type

export const Skip = Schema.Struct({
  reason: Schema.Literals(["self_referential", "out_of_scope", "secret"]),
  text: Schema.optional(Schema.String),
})

export const Operation = Schema.Struct({
  operationCount: Count,
  added: Count,
  removed: Count,
  skipped: Schema.Array(Skip),
  index: Index,
}).annotate({ identifier: "MemoryOperationResult" })
export type Operation = typeof Operation.Type

export const Purge = Schema.Struct({ root: Schema.String, purged: Schema.Boolean })

// User-typed text, not persisted line limits; keys are clamped to 80 characters downstream.
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000))
const Key = Schema.String.check(Schema.isMaxLength(256))
const SessionID = Schema.String.check(Schema.isMaxLength(128))
const Section = Schema.String.check(Schema.isMaxLength(80), Schema.isPattern(/^[^\x00-\x1f\x7f]*$/))

export const Remember = Schema.Struct({
  text: Text,
  key: Schema.optional(Key),
  file: Schema.optional(Source),
  section: Schema.optional(Section),
  sessionID: Schema.optional(SessionID),
})

export const Correct = Schema.Struct({
  text: Text,
  key: Schema.optional(Key),
  sessionID: Schema.optional(SessionID),
})

export const Forget = Schema.Struct({
  query: Text,
  sessionID: Schema.optional(SessionID),
})

export const Configure = Schema.Struct({
  autoConsolidate: Schema.optional(Schema.Boolean),
  verbose: Schema.optional(Schema.Boolean),
})

const Phase = Schema.Literals(["idle", "checking", "injecting", "updating", "skipped", "error"])

export const Event = Schema.Struct({
  /** The memory folder of the project. */
  directory: Schema.String,
  sessionID: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  state: Phase,
  reason: Schema.optional(Schema.String),
  project: Schema.Struct({
    bytes: Count,
    estimatedTokens: Count,
    truncated: Schema.Boolean,
    updatedAt: Schema.optional(Count),
  }),
  consolidation: Schema.optional(
    Schema.Struct({
      trigger: Schema.Literals(["explicit", "turn-close", "rebuild"]),
      operationCount: Count,
      cost: Count,
      tokens: Count,
    }),
  ),
  detail: Schema.optional(
    Schema.Struct({
      type: Schema.Literals(["saved", "skipped", "recalled", "error"]),
      message: Schema.String,
      reason: Schema.optional(Schema.String),
      duplicateOf: Schema.optional(Schema.String),
      tokens: Schema.optional(Count),
      operationCount: Schema.optional(Count),
      added: Schema.optional(Count),
      removed: Schema.optional(Count),
      skippedCount: Schema.optional(Count),
      sources: Schema.optional(Schema.Array(Schema.String)),
      files: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
}).annotate({ identifier: "MemoryEvent" })
export type Event = typeof Event.Type

const failure = portable(Schema.Undefined)
/** Every memory method fails with one of these names; the message is redacted. */
const errors = {
  memory_disabled: failure,
  memory_invalid_input: failure,
  memory_root_error: failure,
  memory_storage_error: failure,
  memory_corrupt_state: failure,
  memory_error: failure,
}
export type ErrorName = keyof typeof errors

const none = portable(Schema.Struct({}))

export const Definition = Rpc.define({
  id: "kilocode.memory",
  methods: {
    /** The memory state and index size of the project. With `sessionID`, also the memory that session used. */
    status: {
      input: portable(Schema.Struct({ sessionID: Schema.optional(SessionID) })),
      output: portable(Status),
      errors,
    },
    /** The stored memory files and inventory. */
    show: { input: none, output: portable(Show), errors },
    /** Enable project memory, creating the memory folder when needed. */
    enable: { input: none, output: portable(Changed), errors },
    /** Disable project memory. Stored memory is kept. */
    disable: { input: none, output: portable(Settings), errors },
    /** Change the automatic save and verbose settings. */
    configure: { input: portable(Configure), output: portable(Settings), errors },
    /** Rebuild the memory index from the source files. */
    rebuild: { input: none, output: portable(Changed), errors },
    /** Save a project memory note. */
    remember: { input: portable(Remember), output: portable(Operation), errors },
    /** Save a correction. */
    correct: { input: portable(Correct), output: portable(Operation), errors },
    /** Remove matching memory. */
    forget: { input: portable(Forget), output: portable(Operation), errors },
    /** Delete every memory file of the project. */
    purge: { input: portable(Schema.Struct({ confirm: Schema.Literal(true) })), output: portable(Purge), errors },
  },
  events: {
    /** Memory state changed: enabled, disabled, configured, injected, recalled or skipped. */
    status: { schema: portable(Event) },
    /** Stored memory changed. */
    updated: { schema: portable(Event) },
    /** A memory operation failed. */
    error: { schema: portable(Event) },
  },
})
