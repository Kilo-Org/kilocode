import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { jest } from "bun:test"
import { createLeaderChain } from "../src/leader"
import type { LeaderChain } from "../src/leader"

describe("createLeaderChain", () => {
  let chain: LeaderChain

  beforeEach(() => {
    chain = createLeaderChain({ timeoutMs: 2000 })
  })

  test("activate sets isActive to true", () => {
    expect(chain.isActive()).toBe(false)
    chain.activate()
    expect(chain.isActive()).toBe(true)
  })

  test("press while active consumes key and resets state", () => {
    chain.activate()
    const result = chain.press("p")
    expect(result).toBe("chained")
    expect(chain.isActive()).toBe(false)
  })

  test("press while inactive returns reset", () => {
    expect(chain.isActive()).toBe(false)
    const result = chain.press("p")
    expect(result).toBe("reset")
  })

  test("2s timeout resets state automatically", () => {
    jest.useFakeTimers()
    try {
      const timedChain = createLeaderChain({ timeoutMs: 2000 })
      timedChain.activate()
      expect(timedChain.isActive()).toBe(true)

      jest.advanceTimersByTime(2100)

      expect(timedChain.isActive()).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  test("cancel ends chain immediately without pressing a key", () => {
    chain.activate()
    expect(chain.isActive()).toBe(true)
    chain.cancel()
    expect(chain.isActive()).toBe(false)
  })

  test("flat chains: press after chained press returns reset (no nesting)", () => {
    chain.activate()
    // First press consumes the key and resets the chain
    const first = chain.press("p")
    expect(first).toBe("chained")
    expect(chain.isActive()).toBe(false)

    // Second press without re-activating is inactive → reset
    const second = chain.press("q")
    expect(second).toBe("reset")
  })

  test("activate while already active resets the timer", () => {
    jest.useFakeTimers()
    try {
      const timedChain = createLeaderChain({ timeoutMs: 2000 })
      timedChain.activate()

      // Advance halfway through the timeout
      jest.advanceTimersByTime(1500)
      expect(timedChain.isActive()).toBe(true)

      // Re-activate resets the timer
      timedChain.activate()
      jest.advanceTimersByTime(1500)
      // Should still be active — the timer was reset
      expect(timedChain.isActive()).toBe(true)

      // Now advance past the full 2000ms from the second activate
      jest.advanceTimersByTime(600)
      expect(timedChain.isActive()).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  test("cancel on inactive chain is a no-op", () => {
    expect(chain.isActive()).toBe(false)
    expect(() => chain.cancel()).not.toThrow()
    expect(chain.isActive()).toBe(false)
  })
})
