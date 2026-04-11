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

  test("mutex handles timeout on acquisition", async () => {
    const { Mutex } = await import("@/devilcode/workflow/mutex")

    const mutex = new Mutex()
    const order: number[] = []

    // Start a long-running task that holds the lock
    const longTask = mutex.run(async () => {
      order.push(1)
      await new Promise((r) => setTimeout(r, 100))
      order.push(2)
    })

    // Second task should timeout waiting for lock
    const shortTask = mutex.run(
      async () => {
        order.push(3)
      },
      10, // 10ms timeout
    )

    await expect(shortTask).rejects.toThrow("Mutex acquisition timeout")
    await longTask // let the first task complete
    expect(order).toEqual([1, 2])
  })

  test("mutex queue overflow protection", async () => {
    const { Mutex } = await import("@/devilcode/workflow/mutex")

    const mutex = new Mutex()
    const order: number[] = []

    // Start a long-running task that holds the lock
    const longTask = mutex.run(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })

    // Queue 100 more tasks (max queue size)
    const tasks: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      tasks.push(
        mutex.run(async () => {
          order.push(i)
        }),
      )
    }

    // 101st task should overflow
    await expect(
      mutex.run(async () => {
        order.push(999)
      }),
    ).rejects.toThrow("Mutex queue overflow")

    await longTask
    // Don't wait for all queued tasks - just verify overflow works
  })

  test("mutex releases lock even on error", async () => {
    const { Mutex } = await import("@/devilcode/workflow/mutex")

    const mutex = new Mutex()
    let acquired = false

    await expect(
      mutex.run(async () => {
        acquired = true
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")

    expect(acquired).toBe(true)

    // Second task should still acquire lock
    const result = await mutex.run(async () => {
      return "success"
    })
    expect(result).toBe("success")
  })
})
