import { Schema } from "effect"
import type { MemoryOperations } from "../capture/operations"
import { MemorySchema } from "../schema"

/** Effect Schema mirror of the memory data model, shared by host HTTP contracts so it stays next to
 * MemorySchema. The wire shape coerces nullable timestamps to 0 / "" before returning ApiState. */
export namespace MemoryContract {
  const root = "/memory"
  const Source = Schema.Literals(MemorySchema.Sources)
  const Section = Schema.String.check(Schema.isMaxLength(80), Schema.isPattern(/^[^\x00-\x1f\x7f]*$/))

  export const Capture = Schema.Struct({
    mode: Schema.Literal("selective"),
    turnClose: Schema.Boolean,
    explicit: Schema.Boolean,
    maxOpsPerRun: Schema.Finite,
    minIntervalMs: Schema.Finite,
    timeoutMs: Schema.Finite,
  })

  export const Limits = Schema.Struct({
    maxProjectIndexBytes: Schema.Finite,
    maxSessionFiles: Schema.Finite,
    maxRecentSessions: Schema.Finite,
    maxConsolidationInputBytes: Schema.Finite,
    maxLineChars: Schema.Finite,
    maxSessionLineChars: Schema.Finite,
  })

  export const Stats = Schema.Struct({
    lastInjectedAt: Schema.Finite,
    lastInjectedBytes: Schema.Finite,
    lastInjectedTokens: Schema.Finite,
    lastInjectedSessionID: Schema.String,
    lastTypedConsolidationAt: Schema.Finite,
    lastConsolidationCost: Schema.Finite,
    lastConsolidationTokens: Schema.Finite,
    lastOperationCount: Schema.Finite,
    lastRecallAt: Schema.Finite,
    lastRecallCount: Schema.Finite,
    lastRecallSessionID: Schema.String,
  })

  export const State = Schema.Struct({
    version: Schema.Literal(1),
    enabled: Schema.Boolean,
    scope: Schema.Literal("project"),
    autoInject: Schema.Boolean,
    autoConsolidate: Schema.Boolean,
    capture: Capture,
    limits: Limits,
    stats: Stats,
  })

  export const Index = Schema.Struct({
    text: Schema.String,
    bytes: Schema.Finite,
    tokens: Schema.Finite,
    truncated: Schema.Boolean,
  })

  export const Skip = Schema.Struct({
    reason: Schema.Literals(["self_referential", "out_of_scope", "secret"]),
    text: Schema.optional(Schema.String),
  })

  export const Status = Schema.Struct({
    root: Schema.String,
    state: State,
    exists: Schema.Struct({
      state: Schema.Boolean,
      index: Schema.Boolean,
    }),
    index: Schema.Struct({
      bytes: Schema.Finite,
      estimatedTokens: Schema.Finite,
      preview: Schema.String,
    }),
  })

  export const Show = Schema.Struct({
    root: Schema.String,
    state: State,
    sources: Schema.Struct({
      project: Schema.String,
      environment: Schema.String,
      corrections: Schema.String,
    }),
    index: Schema.String,
    items: Schema.String,
    changes: Schema.String,
    decisions: Schema.String,
  })

  export const Enable = Schema.Struct({
    root: Schema.String,
    state: State,
    index: Index,
  })

  export const Disable = Schema.Struct({
    root: Schema.String,
    state: State,
  })

  export const Configure = Schema.Struct({
    root: Schema.String,
    state: State,
  })

  export const Operation = Schema.Struct({
    operationCount: Schema.Finite,
    added: Schema.Finite,
    removed: Schema.Finite,
    skipped: Schema.Array(Skip),
    index: Index,
  })

  export const Purge = Schema.Struct({
    root: Schema.String,
    purged: Schema.Boolean,
  })

  // CLI/API strings are user-typed, not persisted line limits; keep the cap generous but finite.
  const PayloadText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000))
  // Keys are clamped to 80 chars downstream; cap the wire payload generously above that.
  const PayloadKey = Schema.String.check(Schema.isMaxLength(256))
  // Session ids are short host-generated identifiers.
  const PayloadSessionID = Schema.String.check(Schema.isMaxLength(128))

  export const RememberPayload = Schema.Struct({
    text: PayloadText,
    key: Schema.optional(PayloadKey),
    file: Schema.optional(Source),
    section: Schema.optional(Section),
    sessionID: Schema.optional(PayloadSessionID),
  })

  export const CorrectPayload = Schema.Struct({
    text: PayloadText,
    key: Schema.optional(PayloadKey),
    sessionID: Schema.optional(PayloadSessionID),
  })

  export const ForgetPayload = Schema.Struct({
    query: PayloadText,
    sessionID: Schema.optional(PayloadSessionID),
  })

  export const ConfigurePayload = Schema.Struct({
    autoConsolidate: Schema.optional(Schema.Boolean),
  })

  export const PurgePayload = Schema.Struct({
    confirm: Schema.Literal(true),
  })

  export const Paths = {
    status: `${root}/status`,
    show: `${root}/show`,
    enable: `${root}/enable`,
    disable: `${root}/disable`,
    configure: `${root}/configure`,
    rebuild: `${root}/rebuild`,
    remember: `${root}/remember`,
    correct: `${root}/correct`,
    forget: `${root}/forget`,
    purge: `${root}/purge`,
  } as const

  export type ApiState = Omit<MemorySchema.State, "stats"> & {
    stats: Omit<
      MemorySchema.Stats,
      | "lastInjectedAt"
      | "lastInjectedSessionID"
      | "lastTypedConsolidationAt"
      | "lastConsolidatedMessageID"
      | "lastRecallAt"
      | "lastRecallSessionID"
    > & {
      lastInjectedAt: number
      lastInjectedSessionID: string
      lastTypedConsolidationAt: number
      lastRecallAt: number
      lastRecallSessionID: string
    }
  }

  export type ApiOperation = MemoryOperations.Result

  export function state(input: MemorySchema.State): ApiState {
    return {
      ...input,
      stats: {
        lastInjectedAt: input.stats.lastInjectedAt ?? 0,
        lastInjectedBytes: input.stats.lastInjectedBytes,
        lastInjectedTokens: input.stats.lastInjectedTokens,
        lastInjectedSessionID: input.stats.lastInjectedSessionID ?? "",
        lastTypedConsolidationAt: input.stats.lastTypedConsolidationAt ?? 0,
        lastConsolidationCost: input.stats.lastConsolidationCost,
        lastConsolidationTokens: input.stats.lastConsolidationTokens,
        lastOperationCount: input.stats.lastOperationCount,
        lastRecallAt: input.stats.lastRecallAt ?? 0,
        lastRecallCount: input.stats.lastRecallCount,
        lastRecallSessionID: input.stats.lastRecallSessionID ?? "",
      },
    }
  }

  export function output<T extends { state: MemorySchema.State }>(input: T): Omit<T, "state"> & { state: ApiState } {
    return { ...input, state: state(input.state) }
  }

  export function operation(input: MemoryOperations.Result): ApiOperation {
    return {
      operationCount: input.operationCount,
      added: input.added,
      removed: input.removed,
      skipped: input.skipped,
      index: input.index,
    }
  }
}
