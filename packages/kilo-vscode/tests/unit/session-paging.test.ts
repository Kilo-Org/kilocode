import { describe, expect, it } from "bun:test"
import { createSignal } from "solid-js"
import { complete, createSessionPaging, mergeSessionsLoaded } from "../../webview-ui/src/context/session-paging"

type Store = Record<string, { id: string }>

function apply(input: {
  initial: Store
  loaded: Array<{ id: string }>
  preserve?: string[]
  append?: boolean
  hasMore?: boolean
  open?: string[]
  fresh?: Set<string>
}): Store {
  const store: Store = { ...input.initial }
  mergeSessionsLoaded({
    loaded: input.loaded as never,
    preserve: input.preserve,
    append: input.append,
    hasMore: input.hasMore,
    open: input.open,
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

  it("keeps only open sessions from older pages when more pages exist", () => {
    const store = apply({
      initial: { a: { id: "a" }, older: { id: "older" }, tab: { id: "tab" } },
      loaded: [{ id: "a" }],
      hasMore: true,
      open: ["tab"],
    })

    expect(Object.keys(store).sort()).toEqual(["a", "tab"])
  })

  it("drops an open session that a complete list no longer has", () => {
    const store = apply({
      initial: { a: { id: "a" }, gone: { id: "gone" } },
      loaded: [{ id: "a" }],
      open: ["gone"],
    })

    expect(Object.keys(store).sort()).toEqual(["a"])
  })
})

describe("complete", () => {
  it("treats only a full load with no more pages as the whole list", () => {
    expect(complete({})).toBe(true)
    expect(complete({ hasMore: false })).toBe(true)
    expect(complete({ hasMore: true })).toBe(false)
    expect(complete({ append: true, hasMore: false })).toBe(false)
  })
})

describe("createSessionPaging keep", () => {
  it("lists the tab ids it keeps until they are released", () => {
    const paging = createSessionPaging(
      () => {},
      () => true,
    )
    const [tabs, setTabs] = createSignal(["ses_tab"])
    const release = paging.keep(tabs)
    expect(paging.open()).toEqual(["ses_tab"])

    setTabs(["ses_tab", "ses_old"])
    expect(paging.open()).toEqual(["ses_tab", "ses_old"])

    release()
    expect(paging.open()).toEqual([])
  })
})
