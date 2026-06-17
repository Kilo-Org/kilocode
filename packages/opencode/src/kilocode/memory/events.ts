import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import type { MemorySchema } from "@kilocode/kilo-memory/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Schema } from "effect"

export namespace MemoryEvents {
  const log = Log.create({ service: "memory.events" })

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

  export const Status = BusEvent.define("memory.status", Payload)
  export const Updated = BusEvent.define("memory.updated", Payload)
  export const Error = BusEvent.define("memory.error", Payload)

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
    const updated = latest(input.state.stats.lastInjectedAt, input.state.stats.lastConsolidatedAt)
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

  export async function publish(input: { event?: "status" | "updated" | "error"; payload: Status }) {
    const def = input.event === "updated" ? Updated : input.event === "error" ? Error : Status
    const emit = (() => {
      try {
        return Instance.bind((payload: Status) => Bus.publish(def, payload))
      } catch (_error) {
        return (payload: Status) => Bus.publish(def, payload)
      }
    })()
    try {
      await emit(input.payload)
    } catch (err) {
      log.warn("failed to publish memory event", { err, type: def.type })
    }
  }
}
