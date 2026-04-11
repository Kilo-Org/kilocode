import { describe, it, expect } from "bun:test"
import { Mutex } from "@/devilcode/workflow/mutex"

describe("workflow mutex", () => {
  describe("Mutex", () => {
    it("serializes concurrent operations", async () => {
      const mutex = new Mutex()
      const results: number[] = []

      const op1 = mutex.run(async () => {
        results.push(1)
        await new Promise((r) => setTimeout(r, 10))
        results.push(2)
        return "op1"
      })

      const op2 = mutex.run(async () => {
        results.push(3)
        await new Promise((r) => setTimeout(r, 10))
        results.push(4)
        return "op2"
      })

      const [r1, r2] = await Promise.all([op1, op2])

      expect(r1).toBe("op1")
      expect(r2).toBe("op2")
      // Operations should be serialized: 1,2,3,4 not interleaved
      expect(results).toEqual([1, 2, 3, 4])
    })

    it("allows sequential operations without queueing", async () => {
      const mutex = new Mutex()

      const r1 = await mutex.run(async () => "first")
      const r2 = await mutex.run(async () => "second")

      expect(r1).toBe("first")
      expect(r2).toBe("second")
    })

    it("throws on mutex queue overflow", async () => {
      const mutex = new Mutex()
      // @ts-expect-error - accessing private for test
      mutex.maxQueueSize = 2

      // Hold the lock
      const holdLock = mutex.run(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return "held"
      })

      // Fill the queue
      const queued1 = mutex.run(async () => "queued1")
      const queued2 = mutex.run(async () => "queued2")

      // This should overflow
      const overflow = mutex.run(async () => "overflow")

      await expect(overflow).rejects.toThrow("Mutex queue overflow")

      // Clean up
      await expect(holdLock).resolves.toBe("held")
      await expect(queued1).resolves.toBe("queued1")
      await expect(queued2).resolves.toBe("queued2")
    }, 5000)

    it("times out on mutex acquisition", async () => {
      const mutex = new Mutex()

      // Hold the lock
      const holdLock = mutex.run(async () => {
        await new Promise((r) => setTimeout(r, 500))
        return "held"
      })

      // Try to acquire with short timeout
      const timeout = mutex.run(async () => "timeout", 50)

      await expect(timeout).rejects.toThrow("Mutex acquisition timeout")

      // Clean up
      await holdLock
    }, 5000)

    it("releases lock even when operation throws", async () => {
      const mutex = new Mutex()

      await expect(
        mutex.run(async () => {
          throw new Error("operation failed")
        }),
      ).rejects.toThrow("operation failed")

      // Lock should be released, next operation should succeed
      const result = await mutex.run(async () => "recovered")
      expect(result).toBe("recovered")
    })

    it("handles many concurrent operations", async () => {
      const mutex = new Mutex()
      const operations: Promise<string>[] = []

      for (let i = 0; i < 20; i++) {
        operations.push(
          mutex.run(async () => {
            await new Promise((r) => setTimeout(r, 5))
            return `op-${i}`
          }),
        )
      }

      const results = await Promise.all(operations)
      expect(results).toHaveLength(20)
      expect(results[0]).toBe("op-0")
      expect(results[19]).toBe("op-19")
    }, 5000)

    it("returns correct value from operation", async () => {
      const mutex = new Mutex()

      const result = await mutex.run(async () => {
        return { complex: "value", number: 42 }
      })

      expect(result).toEqual({ complex: "value", number: 42 })
    })

    it("handles sync errors in operation", async () => {
      const mutex = new Mutex()

      await expect(
        mutex.run(() => {
          throw new Error("sync error")
        }),
      ).rejects.toThrow("sync error")
    })
  })
})
