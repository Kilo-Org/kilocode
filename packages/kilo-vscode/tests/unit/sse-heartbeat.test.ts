import { describe, expect, it } from "bun:test"
import { SSEHeartbeat } from "../../src/services/sse-heartbeat"

function timers() {
  const timeout = globalThis.setTimeout
  const clear = globalThis.clearTimeout
  const tasks = new Map<number, () => void>()
  let id = 0

  globalThis.setTimeout = ((callback: () => void) => {
    id += 1
    tasks.set(id, callback)
    return id
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((timer: number) => {
    tasks.delete(timer)
  }) as unknown as typeof clearTimeout

  return {
    flush() {
      const callbacks = [...tasks.values()]
      tasks.clear()
      for (const callback of callbacks) callback()
    },
    restore() {
      globalThis.setTimeout = timeout
      globalThis.clearTimeout = clear
    },
    size() {
      return tasks.size
    },
  }
}

describe("SSEHeartbeat", () => {
  it("replaces the pending timeout when reset", () => {
    const clock = timers()
    let calls = 0
    const heartbeat = new SSEHeartbeat(15_000, () => {
      calls += 1
    })

    try {
      heartbeat.reset()
      heartbeat.reset()

      expect(clock.size()).toBe(1)
      clock.flush()
      expect(calls).toBe(1)
    } finally {
      heartbeat.dispose()
      clock.restore()
    }
  })

  it("runs the timeout callback", () => {
    const clock = timers()
    let calls = 0
    const heartbeat = new SSEHeartbeat(15_000, () => {
      calls += 1
    })

    try {
      heartbeat.reset()
      clock.flush()

      expect(calls).toBe(1)
      expect(clock.size()).toBe(0)
    } finally {
      heartbeat.dispose()
      clock.restore()
    }
  })

  it("clears the pending timeout after normal termination", () => {
    const clock = timers()
    let calls = 0
    const heartbeat = new SSEHeartbeat(15_000, () => {
      calls += 1
    })

    try {
      heartbeat.reset()
      heartbeat.dispose()
      clock.flush()

      expect(calls).toBe(0)
      expect(clock.size()).toBe(0)
    } finally {
      heartbeat.dispose()
      clock.restore()
    }
  })

  it("clears the pending timeout when disposed repeatedly", () => {
    const clock = timers()
    let calls = 0
    const heartbeat = new SSEHeartbeat(15_000, () => {
      calls += 1
    })

    try {
      heartbeat.reset()
      heartbeat.dispose()
      heartbeat.dispose()
      clock.flush()

      expect(calls).toBe(0)
      expect(clock.size()).toBe(0)
    } finally {
      heartbeat.dispose()
      clock.restore()
    }
  })
})
