import { describe, expect, it } from "bun:test"
import { mergeSessionsLoaded } from "../../webview-ui/src/context/session-paging"

type Store = Record<string, { id: string }>

function apply(input: {
  initial: Store
  loaded: Array<{ id: string }>
  preserve?: string[]
  append?: boolean
  fresh?: Set<string>
}): Store {
  const store: Store = { ...input.initial }
  mergeSessionsLoaded({
    loaded: input.loaded as never,
    preserve: input.preserve,
    append: input.append,
    fresh: input.fresh ?? new Set(),
    setSessions: (updater) => updater(store as never),
  })
  return store
}

describe("mergeSessionsLoaded", () => {
  it("reconciles away sessions that are no longer listed but keeps cloud sessions", () => {
    const store = apply({
      initial: { a: { id: "a" }, b: { id: "b" }, "cloud:1": { id: "cloud:1" } },
      loaded: [{ id: "a" }],
    })

    expect(Object.keys(store).sort()).toEqual(["a", "cloud:1"])
  })

  it("keeps preserved sessions during a full load", () => {
    const store = apply({
      initial: { a: { id: "a" }, b: { id: "b" } },
      loaded: [{ id: "a" }],
      preserve: ["b"],
    })

    expect(Object.keys(store).sort()).toEqual(["a", "b"])
  })

  it("appends older sessions without deleting anything", () => {
    const store = apply({
      initial: { a: { id: "a" }, b: { id: "b" } },
      loaded: [{ id: "c" }],
      append: true,
    })

    expect(Object.keys(store).sort()).toEqual(["a", "b", "c"])
  })
})
