import { Effect, Schema } from "effect"
import { Storage } from "@/storage/storage"
import type { AutonomousState } from "./state"

/**
 * Per-project routing history: how often each model class finished a task of a
 * given complexity, and how many repairs it needed. Feeds the router.
 */
export namespace AutonomousStats {
  export const Cell = Schema.Struct({ runs: Schema.Number, ok: Schema.Number, repairs: Schema.Number, escalations: Schema.Number })
  export type Cell = typeof Cell.Type
  export const Info = Schema.Struct({
    version: Schema.Literal(1),
    projectID: Schema.String,
    cells: Schema.Record(Schema.String, Cell),
    updated: Schema.Number,
  })
  export type Info = typeof Info.Type

  export const key = (projectID: string) => ["autonomous-stats", projectID]
  export const cell = (modelClass: AutonomousState.ModelClass, complexity: number) => `${modelClass}:${complexity}`
  const decode = Schema.decodeUnknownOption(Info)

  export const empty = (projectID: string): Info => ({ version: 1, projectID, cells: {}, updated: 0 })

  export const load = Effect.fn("AutonomousStats.load")(function* (projectID: string) {
    const storage = yield* Storage.Service
    const raw = yield* storage.read<unknown>(key(projectID)).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const parsed = raw === undefined ? undefined : decode(raw)
    return parsed && parsed._tag === "Some" ? parsed.value : empty(projectID)
  })

  export function get(stats: Info | undefined, modelClass: AutonomousState.ModelClass, complexity: number): Cell | undefined {
    return stats?.cells[cell(modelClass, complexity)]
  }

  /** Record a finished task under the class that ran its first attempt. */
  export function record(stats: Info, task: AutonomousState.Task): Info {
    const first = task.first ?? task.failures.find((f) => f.routed)?.routed ?? task.route?.modelClass
    if (!first) return stats
    const id = cell(first, task.complexity)
    const prior = stats.cells[id] ?? { runs: 0, ok: 0, repairs: 0, escalations: 0 }
    const ok = task.status === "completed" && !task.escalated
    const cells = {
      ...stats.cells,
      [id]: {
        runs: prior.runs + 1,
        ok: prior.ok + (ok ? 1 : 0),
        repairs: prior.repairs + Math.max(0, task.attempts - 1),
        escalations: prior.escalations + (task.escalated ? 1 : 0),
      },
    }
    return { ...stats, cells, updated: Date.now() }
  }

  /** Add one finished task to the stored document, re-reading it first so concurrent goals do not drop each other's runs. */
  export const learn = Effect.fn("AutonomousStats.learn")(function* (projectID: string, task: AutonomousState.Task) {
    const storage = yield* Storage.Service
    const current = yield* load(projectID)
    const next = record(current, task)
    yield* storage.write(key(projectID), next).pipe(Effect.orDie)
    return next
  })

  export const save = Effect.fn("AutonomousStats.save")(function* (stats: Info) {
    const storage = yield* Storage.Service
    yield* storage.write(key(stats.projectID), stats).pipe(Effect.orDie)
    return stats
  })

  export function summary(stats: Info) {
    const rows = Object.entries(stats.cells).map(([id, c]) => `${id}: ${c.ok}/${c.runs} ok, ${c.repairs} repairs, ${c.escalations} escalations`)
    return rows.length ? `Routing history:\n${rows.map((r) => `  ${r}`).join("\n")}` : "Routing history: none yet"
  }
}
