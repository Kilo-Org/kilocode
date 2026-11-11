import { describe, expect, test } from "bun:test"
import { createDeferredQuery } from "../webview-ui/src/components/settings/settings-search-query"

function frames() {
  const queue = new Map<number, () => void>()
  let next = 1
  return {
    schedule(run: () => void) {
      const id = next++
      queue.set(id, run)
      return id
    },
    cancel(id: number) {
      queue.delete(id)
    },
    run() {
      const runs = [...queue.values()]
      queue.clear()
      for (const run of runs) run()
    },
    count() {
      return queue.size
    },
  }
}

describe("createDeferredQuery", () => {
  test("stays pending until the scheduled frame runs", () => {
    const frame = frames()
    const query = createDeferredQuery(frame.schedule, frame.cancel)

    query.input("model")

    expect(query.query()).toBe("model")
    expect(query.settled()).toBe("")
    expect(query.pending()).toBe(true)

    frame.run()

    expect(query.settled()).toBe("model")
    expect(query.pending()).toBe(false)
  })

  test("coalesces several keys into one frame", () => {
    const frame = frames()
    const query = createDeferredQuery(frame.schedule, frame.cancel)

    query.input("m")
    query.input("mo")
    query.input("mod")

    expect(frame.count()).toBe(1)
    frame.run()
    expect(query.settled()).toBe("mod")
  })

  test("flush applies the queued query before a list action reads it", () => {
    const frame = frames()
    const query = createDeferredQuery(frame.schedule, frame.cancel)

    query.input("model")
    query.flush()

    expect(query.settled()).toBe("model")
    expect(query.pending()).toBe(false)
    expect(frame.count()).toBe(0)

    frame.run()
    expect(query.settled()).toBe("model")
  })

  test("settles an empty query immediately and clear resets both values", () => {
    const frame = frames()
    const query = createDeferredQuery(frame.schedule, frame.cancel)

    query.input("model")
    query.input("")

    expect(query.settled()).toBe("")
    expect(frame.count()).toBe(0)

    query.input("agent")
    frame.run()
    query.clear()

    expect(query.query()).toBe("")
    expect(query.settled()).toBe("")
    expect(query.pending()).toBe(false)
  })
})
