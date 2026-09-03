import { describe, expect, test } from "bun:test"
import { sender } from "./project-console-presence-sender"

function deferred() {
  const state: { resolve?: () => void } = {}
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve
  })
  return { promise, resolve: () => state.resolve?.() }
}

async function drain() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("project console presence sender", () => {
  test("sends snapshots in order", async () => {
    const first = deferred()
    const calls: string[] = []
    const queue = sender(() => {})

    queue.push({ key: "first", run: () => (calls.push("first"), first.promise) })
    queue.push({ key: "second", run: async () => void calls.push("second") })

    expect(calls).toEqual(["first"])
    first.resolve()
    await drain()
    expect(calls).toEqual(["first", "second"])
  })

  test("deduplicates the last successful snapshot unless forced", async () => {
    const calls: string[] = []
    const queue = sender(() => {})
    const item = { key: "same", run: async () => void calls.push("same") }

    queue.push(item)
    await drain()
    queue.push(item)
    await drain()
    expect(calls).toEqual(["same"])

    queue.push(item, true)
    await drain()
    expect(calls).toEqual(["same", "same"])
  })

  test("does not queue a reactive duplicate of an in-flight snapshot", async () => {
    const wait = deferred()
    const calls: string[] = []
    const queue = sender(() => {})
    const item = { key: "same", run: () => (calls.push("same"), wait.promise) }

    queue.push(item)
    queue.push(item)
    wait.resolve()
    await drain()

    expect(calls).toEqual(["same"])
  })

  test("retains a forced renewal while the same snapshot is in flight", async () => {
    const wait = deferred()
    const calls: string[] = []
    const queue = sender(() => {})
    const item = { key: "same", run: () => (calls.push("same"), calls.length === 1 ? wait.promise : Promise.resolve()) }

    queue.push(item)
    queue.push(item, true)
    expect(calls).toEqual(["same"])

    wait.resolve()
    await drain()
    expect(calls).toEqual(["same", "same"])
  })

  test("replaces an obsolete pending snapshot with the latest state", async () => {
    const first = deferred()
    const calls: string[] = []
    const queue = sender(() => {})

    queue.push({ key: "first", run: () => (calls.push("first"), first.promise) })
    queue.push({ key: "second", run: async () => void calls.push("second") })
    queue.push({ key: "third", run: async () => void calls.push("third") })

    first.resolve()
    await drain()
    expect(calls).toEqual(["first", "third"])
  })
})
