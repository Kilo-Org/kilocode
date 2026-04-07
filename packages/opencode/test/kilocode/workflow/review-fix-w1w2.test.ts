import { describe, test, expect } from "bun:test"

describe("W1/W2: Mutex serializes concurrent operations", () => {
  test("mutex serializes concurrent calls", async () => {
    const { Mutex } = await import("@/devilcode/workflow/mutex")

    const mutex = new Mutex()
    const order: number[] = []

    const task = async (id: number, delayMs: number) => {
      return mutex.run(async () => {
        order.push(id)
        await new Promise((r) => setTimeout(r, delayMs))
        order.push(id * 10)
      })
    }

    await Promise.all([task(1, 50), task(2, 10)])
    expect(order).toEqual([1, 10, 2, 20])
  })
})
