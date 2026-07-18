import type { MementoLike } from "../../src/agent-manager/host"

export interface InspectableMemento extends MementoLike {
  seed(values: Record<string, unknown>): void
  read(key: string): unknown
}

/**
 * Build an in-memory `MementoLike` for unit tests. Supports both
 * populating the slot via `seed()` and asserting against the slot via
 * `read()`.
 */
export function makeMemento(): InspectableMemento {
  const values: Record<string, unknown> = {}
  return {
    seed(v) {
      for (const [k, val] of Object.entries(v)) values[k] = val
    },
    read(key) {
      return values[key]
    },
    get(key) {
      return values[key] as never
    },
    update(key, value) {
      if (value === undefined) delete values[key]
      else values[key] = value
      return Promise.resolve()
    },
  }
}
