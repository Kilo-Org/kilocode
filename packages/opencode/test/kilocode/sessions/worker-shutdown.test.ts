import { describe, expect, test } from "bun:test"
import { createWorkerShutdown } from "../../../src/cli/tui/worker-shutdown"

describe("createWorkerShutdown", () => {
  test("invokes drain before dispose and stopServer", async () => {
    const order: string[] = []
    let resolveDrain!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveDrain = resolve
    })

    const run = createWorkerShutdown({
      drain: async () => {
        order.push("drain-start")
        await gate
        order.push("drain-end")
      },
      dispose: async () => {
        order.push("dispose")
      },
      stopServer: async () => {
        order.push("stopServer")
      },
    })

    const pending = run()
    // dispose must not start while drain is still in flight
    expect(order).toEqual(["drain-start"])

    resolveDrain()
    await pending
    expect(order).toEqual(["drain-start", "drain-end", "dispose", "stopServer"])
  })

  test("awaits drain fully before dispose even when drain is slow", async () => {
    const order: string[] = []
    const run = createWorkerShutdown({
      drain: async () => {
        order.push("drain")
        await Promise.resolve()
        await Promise.resolve()
      },
      dispose: async () => {
        order.push("dispose")
      },
      stopServer: async () => {
        order.push("stop")
      },
    })

    await run()
    expect(order.indexOf("drain")).toBeLessThan(order.indexOf("dispose"))
    expect(order.indexOf("dispose")).toBeLessThan(order.indexOf("stop"))
  })
})
