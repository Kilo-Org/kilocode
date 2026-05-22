import { describe, it, expect } from "bun:test"
import { Semaphore } from "../../src/agent-manager/semaphore"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("Semaphore", () => {
  it("runs tasks up to the concurrency limit", async () => {
    const sem = new Semaphore(2)
    let running = 0
    let peak = 0

    const task = () =>
      sem.run(async () => {
        running++
        peak = Math.max(peak, running)
        await delay(50)
        running--
      })

    await Promise.all([task(), task(), task(), task(), task()])
    expect(peak).toBe(2)
    expect(running).toBe(0)
  })

  it("returns the value produced by the function", async () => {
    const sem = new Semaphore(1)
    const result = await sem.run(async () => 42)
    expect(result).toBe(42)
  })

  it("propagates rejections without blocking the queue", async () => {
    const sem = new Semaphore(1)
    const order: string[] = []

    const failing = sem.run(async () => {
      order.push("fail-start")
      throw new Error("boom")
    })

    const passing = sem.run(async () => {
      order.push("pass-start")
      return "ok"
    })

    await expect(failing).rejects.toThrow("boom")
    expect(await passing).toBe("ok")
    expect(order).toEqual(["fail-start", "pass-start"])
  })

  it("processes queued tasks in FIFO order", async () => {
    const sem = new Semaphore(1)
    const order: number[] = []

    // First task holds the slot while 2 and 3 queue
    const t1 = sem.run(async () => {
      order.push(1)
      await delay(50)
    })
    const t2 = sem.run(async () => {
      order.push(2)
    })
    const t3 = sem.run(async () => {
      order.push(3)
    })

    await Promise.all([t1, t2, t3])
    expect(order).toEqual([1, 2, 3])
  })

  it("allows full concurrency when limit exceeds task count", async () => {
    const sem = new Semaphore(10)
    let running = 0
    let peak = 0

    const task = () =>
      sem.run(async () => {
        running++
        peak = Math.max(peak, running)
        await delay(30)
        running--
      })

    await Promise.all([task(), task(), task()])
    expect(peak).toBe(3)
  })

  it("releases the slot on synchronous throw", async () => {
    const sem = new Semaphore(1)

    await expect(
      sem.run(() => {
        throw new Error("sync")
      }),
    ).rejects.toThrow("sync")

    // Slot is free — next task should run immediately
    const result = await sem.run(async () => "recovered")
    expect(result).toBe("recovered")
  })
})
