import { describe, expect, test } from "bun:test"
import {
  DEEP_HEALTH_FAILURE_THRESHOLD,
  SHALLOW_FAILURE_THRESHOLD,
  nextDeepHealthFailureCount,
  nextShallowFailureCount,
  shouldRestartForUnresponsiveness,
  shouldRestartForWedge,
} from "../../src/services/cli-backend/wedge-recovery"

describe("deep health wedge policy", () => {
  test("accumulates failures only while the process is alive but the database is not", () => {
    let count = 0
    count = nextDeepHealthFailureCount(count, true, false)
    expect(count).toBe(1)
    count = nextDeepHealthFailureCount(count, true, false)
    expect(count).toBe(2)
    expect(shouldRestartForWedge(count)).toBe(true)
  })

  test("a successful deep probe clears the streak before the threshold", () => {
    let count = nextDeepHealthFailureCount(0, true, false)
    expect(count).toBe(1)
    count = nextDeepHealthFailureCount(count, true, true)
    expect(count).toBe(0)
    expect(shouldRestartForWedge(count)).toBe(false)
  })

  test("a failed shallow probe does not count as a database wedge", () => {
    expect(nextDeepHealthFailureCount(1, false, false)).toBe(0)
    expect(nextDeepHealthFailureCount(0, false, true)).toBe(0)
  })

  test("does not restart below the threshold", () => {
    for (let i = 0; i < DEEP_HEALTH_FAILURE_THRESHOLD - 1; i++) {
      expect(shouldRestartForWedge(i)).toBe(false)
    }
    expect(shouldRestartForWedge(DEEP_HEALTH_FAILURE_THRESHOLD)).toBe(true)
  })
})

describe("shallow unresponsiveness policy", () => {
  test("accumulates consecutive shallow failures and restarts only at the threshold", () => {
    let count = 0
    for (let i = 1; i < SHALLOW_FAILURE_THRESHOLD; i++) {
      count = nextShallowFailureCount(count, false)
      expect(count).toBe(i)
      expect(shouldRestartForUnresponsiveness(count)).toBe(false)
    }
    count = nextShallowFailureCount(count, false)
    expect(count).toBe(SHALLOW_FAILURE_THRESHOLD)
    expect(shouldRestartForUnresponsiveness(count)).toBe(true)
  })

  test("any successful shallow probe clears the streak", () => {
    expect(nextShallowFailureCount(2, true)).toBe(0)
  })

  test("a non-contiguous failure pattern never reaches the threshold", () => {
    let count = 0
    count = nextShallowFailureCount(count, false)
    count = nextShallowFailureCount(count, false)
    count = nextShallowFailureCount(count, true)
    expect(count).toBe(0)
    count = nextShallowFailureCount(count, false)
    expect(shouldRestartForUnresponsiveness(count)).toBe(false)
  })
})
