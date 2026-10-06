// Live registry of tasks paused by a subagent-view interrupt, keyed by child
// session ID. Dependency-free so session reads can project it synchronously.
//
// It is module-level rather than `InstanceState`: session IDs are globally
// unique, the session read path projects it synchronously, and every entry is
// owned by a `KiloTaskPause.settle` fiber whose finalizer removes it, so an
// instance dispose (which interrupts that fiber) clears its entries.
import { Deferred, Effect } from "effect"

/** Child session metadata key that marks a task paused by the user. Must match the TUI. */
export const KEY = "kilo.task"

export type Entry = { done: Deferred.Deferred<void>; notice: Effect.Effect<void> }

const pauses = new Map<string, Entry>()

export function paused(id: string) {
  return pauses.has(id)
}

export function set(id: string, entry: Entry) {
  pauses.set(id, entry)
}

export function remove(id: string, entry: Entry) {
  if (pauses.get(id) === entry) pauses.delete(id)
}

const watchers = new Map<string, Set<Deferred.Deferred<void>>>()

/** Signal `done` when a prompt to `id` is admitted. Returns the unwatch function. */
export function watch(id: string, done: Deferred.Deferred<void>) {
  const set = watchers.get(id) ?? new Set()
  set.add(done)
  watchers.set(id, set)
  return () => {
    set.delete(done)
    if (set.size === 0 && watchers.get(id) === set) watchers.delete(id)
  }
}

/** A prompt to `id` was admitted and will run a turn: resume its paused task and tell watchers. */
export const admit = (id: string) =>
  Effect.gen(function* () {
    yield* resume(id)
    for (const done of watchers.get(id) ?? []) yield* Deferred.succeed(done, undefined)
  })

/** The paused child was directed again: the task waits for its next turn. */
export const resume = (id: string) =>
  Effect.suspend(() => {
    const entry = pauses.get(id)
    if (!entry) return Effect.succeed(false)
    pauses.delete(id)
    return Deferred.succeed(entry.done, undefined)
  })

/** Post the paused notice for a task that is (now) a background task. No-op when not paused. */
export const announce = (id: string) => Effect.suspend(() => pauses.get(id)?.notice ?? Effect.void)

/** Session metadata as clients should see it: the pause marker exactly while the pause is live. */
export function project(id: string, metadata?: Record<string, unknown> | null) {
  if (pauses.has(id)) return { ...metadata, [KEY]: { status: "paused" } }
  if (!metadata || !(KEY in metadata)) return metadata ?? undefined
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== KEY))
}

export * as KiloTaskPauseState from "./task-pause-state"
