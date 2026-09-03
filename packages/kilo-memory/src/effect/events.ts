import { Schema } from "effect"
import type { MemorySchema } from "../schema"
import { MemoryLog } from "./log"

export namespace MemoryEvents {
  const Metric = Schema.Struct({
    bytes: Schema.Number,
    estimatedTokens: Schema.Number,
    truncated: Schema.Boolean,
    updatedAt: Schema.optional(Schema.Number),
  })

  const Phase = Schema.Literals(["idle", "checking", "injecting", "updating", "skipped", "error"])
  const Trigger = Schema.Literals(["explicit", "turn-close", "rebuild"])

  const Consolidation = Schema.Struct({
    trigger: Trigger,
    operationCount: Schema.Number,
    cost: Schema.Number,
    tokens: Schema.Number,
  })

  const Detail = Schema.Struct({
    type: Schema.Literals(["saved", "skipped", "recalled"]),
    message: Schema.String,
    reason: Schema.optional(Schema.String),
    duplicateOf: Schema.optional(Schema.String),
    tokens: Schema.optional(Schema.Number),
    operationCount: Schema.optional(Schema.Number),
    added: Schema.optional(Schema.Number),
    removed: Schema.optional(Schema.Number),
    skippedCount: Schema.optional(Schema.Number),
    sources: Schema.optional(Schema.Array(Schema.String)),
    files: Schema.optional(Schema.Array(Schema.String)),
  })

  export const Payload = Schema.Struct({
    directory: Schema.String,
    sessionID: Schema.optional(Schema.String),
    enabled: Schema.Boolean,
    state: Phase,
    reason: Schema.optional(Schema.String),
    project: Metric,
    consolidation: Schema.optional(Consolidation),
    detail: Schema.optional(Detail),
  })

  export type Phase = Schema.Schema.Type<typeof Phase>
  export type Trigger = Schema.Schema.Type<typeof Trigger>
  export type Status = Schema.Schema.Type<typeof Payload>
  export type Index = { bytes: number; tokens: number; truncated: boolean }

  export type Inspect = {
    root: string
    state: MemorySchema.State
    sources: {
      project: string
      environment: string
      corrections: string
    }
    index: string
    changes: string
  }

  function metric(index?: Index, updatedAt?: number | null) {
    return {
      bytes: index?.bytes ?? 0,
      estimatedTokens: index?.tokens ?? 0,
      truncated: index?.truncated ?? false,
      ...(updatedAt ? { updatedAt } : {}),
    }
  }

  function latest(...items: (number | null)[]) {
    const values = items.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    return values.length ? Math.max(...values) : undefined
  }

  export function status(input: {
    root: string
    state: MemorySchema.State
    index?: Index
    phase?: Phase
    reason?: string
    sessionID?: string
    consolidation?: Status["consolidation"]
    detail?: Status["detail"]
  }): Status {
    const updated = latest(input.state.stats.lastInjectedAt, input.state.stats.lastTypedConsolidationAt)
    const current = metric(input.index, updated)
    return {
      directory: input.root,
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
      enabled: input.state.enabled,
      state: input.phase ?? "idle",
      ...(input.reason ? { reason: input.reason } : {}),
      project: current,
      ...(input.consolidation ? { consolidation: input.consolidation } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    }
  }

  export type Event = "status" | "updated" | "error"
  export type Sink = (input: { event?: Event; payload: Status }) => Promise<void> | void

  // Best-effort: opencode wires this to its Bus at bootstrap; defaults to a no-op so the package
  // never reaches into the host event system on its own.
  let sink: Sink = () => {}

  export function setSink(next: Sink) {
    sink = next
  }

  export async function publish(input: { event?: Event; payload: Status }) {
    // Event wiring is best-effort: a failing host sink must not fail a memory op that already
    // persisted, so swallow and log instead of propagating to callers.
    try {
      await sink(input)
    } catch (err) {
      MemoryLog.warn("memory event publish failed", {
        err: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      })
    }
  }
}
