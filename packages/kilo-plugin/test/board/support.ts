import type { StorageScanOptions } from "@opencode/plugin/storage"
import { Effect, Schema } from "effect"
import type { BoardStore } from "../../src/board/store"

/** Key/value storage with the core KV scan contract: ascending keys, prefix, exclusive `after`, `next` when more. */
export function memory() {
  const entries = new Map<string, Schema.Json>()
  return {
    entries,
    get: (key: string) => Effect.sync(() => entries.get(key)),
    set: (key: string, value: Schema.Json) => Effect.sync(() => void entries.set(key, structuredClone(value))),
    remove: (key: string) => Effect.sync(() => void entries.delete(key)),
    scan: (options: StorageScanOptions) =>
      Effect.sync(() => {
        const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 1000)
        const keys = [...entries.keys()]
          .filter((key) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
          .sort()
        const page = keys.slice(0, limit).map((key) => ({ key, value: entries.get(key)! }))
        if (keys.length <= limit) return { entries: page }
        return { entries: page, next: page[page.length - 1].key }
      }),
  }
}

export type Fixture = ReturnType<typeof fixture>

/** A session family on the board runtime: `ses_root` with children `ses_child` and `ses_sibling`. */
export function fixture(options: { directory?: string } = {}) {
  const directory = options.directory ?? "/repo"
  const storage = memory()
  const sessions = new Map<string, BoardStore.Member>()
  const states = new Map<string, BoardStore.Execution>()
  const add = (member: Partial<BoardStore.Member> & { id: string }) => {
    sessions.set(member.id, {
      projectID: "p",
      directory,
      title: member.id.replace(/^ses_/, ""),
      created: sessions.size + 1,
      ...member,
    })
  }
  add({ id: "ses_root", title: "Root" })
  add({ id: "ses_child", parentID: "ses_root", title: "Child" })
  add({ id: "ses_sibling", parentID: "ses_root", title: "Sibling" })
  const runtime: BoardStore.Runtime = {
    storage,
    session: (id) => Effect.sync(() => sessions.get(id)),
    children: (id) => Effect.sync(() => [...sessions.values()].filter((member) => member.parentID === id)),
    execution: (ids) =>
      Effect.sync(() => ({
        observedAt: 100,
        sessions: new Map(ids.flatMap((id): [string, BoardStore.Execution][] => {
          const state = states.get(id)
          return state ? [[id, state]] : []
        })),
      })),
  }
  return { runtime, storage, sessions, states, add, directory }
}

export const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
export const flip = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))
