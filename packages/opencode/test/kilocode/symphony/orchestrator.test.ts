import { describe, expect, test } from "bun:test"
import {
  createState,
  availableSlots,
  availableSlotsForState,
  claimIssue,
  releaseIssue,
  addRunning,
  removeRunning,
  updateTokenTotals,
} from "@/devilcode/symphony/state"
import { SymphonyConfig } from "@/devilcode/symphony/config/schema"
import type { RunningEntry } from "@/devilcode/symphony/types"
import type { WorkerHandle } from "@/devilcode/symphony/worker"

function makeConfig(overrides?: {
  max_concurrent_agents?: number
  max_concurrent_agents_by_state?: Record<string, number>
}): SymphonyConfig {
  return SymphonyConfig.parse({
    tracker: { kind: "linear", api_key: "test-key", project_slug: "TEST" },
    agent: {
      max_concurrent_agents: overrides?.max_concurrent_agents ?? 5,
      max_concurrent_agents_by_state:
        overrides?.max_concurrent_agents_by_state ?? {},
    },
  })
}

function makeEntry(
  partial?: Partial<RunningEntry>,
): RunningEntry {
  const now = Date.now()
  return {
    issueId: "id1",
    identifier: "TEST-1",
    state: "Todo",
    sessionId: "s1",
    workspacePath: "/tmp/workspace",
    turnCount: 0,
    startedAt: now,
    lastEventAt: now,
    tokens: { input: 0, output: 0, total: 0 },
    ...partial,
  }
}

function makeHandle(entry: RunningEntry): WorkerHandle {
  return {
    issueId: entry.issueId,
    identifier: entry.identifier,
    sessionId: entry.sessionId,
    stop: async () => {},
    getStatus: () => entry,
  }
}

// ---------------------------------------------------------------------------
// createState
// ---------------------------------------------------------------------------
describe("createState", () => {
  test("returns empty state with all required fields", () => {
    const state = createState()
    expect(state.running).toBeInstanceOf(Map)
    expect(state.running.size).toBe(0)
    expect(state.claimed).toBeInstanceOf(Set)
    expect(state.claimed.size).toBe(0)
    expect(state.retryQueue).toBeInstanceOf(Map)
    expect(state.retryQueue.size).toBe(0)
    expect(state.tokenTotals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    })
    expect(state.rateLimits).toBeNull()
  })

  test("returns independent state instances", () => {
    const a = createState()
    const b = createState()
    a.claimed.add("issue-x")
    expect(b.claimed.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// availableSlots
// ---------------------------------------------------------------------------
describe("availableSlots", () => {
  test("returns max_concurrent when nothing is running", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 3 })
    expect(availableSlots(state, config)).toBe(3)
  })

  test("subtracts running count from max_concurrent", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 3 })
    const entry = makeEntry({ issueId: "a" })
    addRunning(state, "a", entry, makeHandle(entry))
    expect(availableSlots(state, config)).toBe(2)
  })

  test("returns 0 when running equals max_concurrent", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 2 })
    for (const id of ["a", "b"]) {
      const entry = makeEntry({ issueId: id, identifier: `TEST-${id}` })
      addRunning(state, id, entry, makeHandle(entry))
    }
    expect(availableSlots(state, config)).toBe(0)
  })

  test("never returns negative when running exceeds max_concurrent", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 1 })
    for (const id of ["a", "b", "c"]) {
      const entry = makeEntry({ issueId: id })
      addRunning(state, id, entry, makeHandle(entry))
    }
    expect(availableSlots(state, config)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// availableSlotsForState
// ---------------------------------------------------------------------------
describe("availableSlotsForState", () => {
  test("returns global slots when no per-state limit is set", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 4 })
    expect(availableSlotsForState(state, "Todo", config)).toBe(4)
  })

  test("respects per-state limit", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { todo: 2 },
    })
    expect(availableSlotsForState(state, "Todo", config)).toBe(2)
  })

  test("subtracts running issues in that state from per-state limit", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { todo: 2 },
    })
    const entry = makeEntry({ issueId: "a", state: "Todo" })
    addRunning(state, "a", entry, makeHandle(entry))
    expect(availableSlotsForState(state, "Todo", config)).toBe(1)
  })

  test("returns min of global and per-state slots", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 1,
      max_concurrent_agents_by_state: { todo: 5 },
    })
    // Global limit is 1 (more restrictive), per-state limit is 5
    expect(availableSlotsForState(state, "Todo", config)).toBe(1)
  })

  test("per-state matching is case-insensitive", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { "in progress": 3 },
    })
    expect(availableSlotsForState(state, "In Progress", config)).toBe(3)
  })

  test("does not count running issues in different states", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { todo: 2 },
    })
    // Add a running issue in "In Progress" state, not "Todo"
    const entry = makeEntry({ issueId: "a", state: "In Progress" })
    addRunning(state, "a", entry, makeHandle(entry))
    // "Todo" per-state slot should still be 2
    expect(availableSlotsForState(state, "Todo", config)).toBe(2)
  })

  test("returns 0 when per-state limit is exhausted", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { todo: 1 },
    })
    const entry = makeEntry({ issueId: "a", state: "Todo" })
    addRunning(state, "a", entry, makeHandle(entry))
    expect(availableSlotsForState(state, "Todo", config)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// claimIssue
// ---------------------------------------------------------------------------
describe("claimIssue", () => {
  test("adds issue ID to claimed set", () => {
    const state = createState()
    claimIssue(state, "issue-1")
    expect(state.claimed.has("issue-1")).toBe(true)
  })

  test("claiming the same issue twice is idempotent", () => {
    const state = createState()
    claimIssue(state, "issue-1")
    claimIssue(state, "issue-1")
    expect(state.claimed.size).toBe(1)
  })

  test("can claim multiple distinct issues", () => {
    const state = createState()
    claimIssue(state, "issue-1")
    claimIssue(state, "issue-2")
    expect(state.claimed.size).toBe(2)
    expect(state.claimed.has("issue-1")).toBe(true)
    expect(state.claimed.has("issue-2")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// releaseIssue
// ---------------------------------------------------------------------------
describe("releaseIssue", () => {
  test("removes issue from claimed set", () => {
    const state = createState()
    claimIssue(state, "issue-1")
    releaseIssue(state, "issue-1")
    expect(state.claimed.has("issue-1")).toBe(false)
  })

  test("removes issue from running map", () => {
    const state = createState()
    const entry = makeEntry({ issueId: "issue-1" })
    addRunning(state, "issue-1", entry, makeHandle(entry))
    claimIssue(state, "issue-1")
    releaseIssue(state, "issue-1")
    expect(state.running.has("issue-1")).toBe(false)
    expect(state.claimed.has("issue-1")).toBe(false)
  })

  test("releasing an unclaimed issue is a no-op", () => {
    const state = createState()
    releaseIssue(state, "nonexistent")
    expect(state.claimed.size).toBe(0)
    expect(state.running.size).toBe(0)
  })

  test("clears retry queue entry and timer for the issue", () => {
    const state = createState()
    // Manually insert a retry entry to verify releaseIssue clears it
    const timerHandle = setTimeout(() => {}, 100000)
    state.retryQueue.set("issue-1", {
      issueId: "issue-1",
      identifier: "TEST-1",
      attempt: 1,
      dueAtMs: Date.now() + 10000,
      error: "test error",
      timerHandle,
    })
    claimIssue(state, "issue-1")
    releaseIssue(state, "issue-1")
    expect(state.retryQueue.has("issue-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// addRunning
// ---------------------------------------------------------------------------
describe("addRunning", () => {
  test("adds entry and handle to running map", () => {
    const state = createState()
    const entry = makeEntry()
    const handle = makeHandle(entry)
    addRunning(state, "id1", entry, handle)

    expect(state.running.size).toBe(1)
    expect(state.running.has("id1")).toBe(true)

    const stored = state.running.get("id1")!
    expect(stored.entry).toBe(entry)
    expect(stored.handle).toBe(handle)
  })

  test("overwrites existing entry for same issue ID", () => {
    const state = createState()
    const entry1 = makeEntry({ sessionId: "s1" })
    const entry2 = makeEntry({ sessionId: "s2" })
    addRunning(state, "id1", entry1, makeHandle(entry1))
    addRunning(state, "id1", entry2, makeHandle(entry2))

    expect(state.running.size).toBe(1)
    expect(state.running.get("id1")!.entry.sessionId).toBe("s2")
  })

  test("can track multiple running issues", () => {
    const state = createState()
    for (const id of ["a", "b", "c"]) {
      const entry = makeEntry({ issueId: id, identifier: `TEST-${id}` })
      addRunning(state, id, entry, makeHandle(entry))
    }
    expect(state.running.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// removeRunning
// ---------------------------------------------------------------------------
describe("removeRunning", () => {
  test("removes issue from running map", () => {
    const state = createState()
    const entry = makeEntry()
    addRunning(state, "id1", entry, makeHandle(entry))
    removeRunning(state, "id1")
    expect(state.running.size).toBe(0)
    expect(state.running.has("id1")).toBe(false)
  })

  test("removing a non-existent issue is a no-op", () => {
    const state = createState()
    removeRunning(state, "nonexistent")
    expect(state.running.size).toBe(0)
  })

  test("does not affect claimed set", () => {
    const state = createState()
    const entry = makeEntry({ issueId: "id1" })
    claimIssue(state, "id1")
    addRunning(state, "id1", entry, makeHandle(entry))
    removeRunning(state, "id1")
    // removeRunning only deletes from running, NOT from claimed
    expect(state.claimed.has("id1")).toBe(true)
    expect(state.running.has("id1")).toBe(false)
  })

  test("does not affect other running issues", () => {
    const state = createState()
    for (const id of ["a", "b"]) {
      const entry = makeEntry({ issueId: id })
      addRunning(state, id, entry, makeHandle(entry))
    }
    removeRunning(state, "a")
    expect(state.running.size).toBe(1)
    expect(state.running.has("b")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateTokenTotals
// ---------------------------------------------------------------------------
describe("updateTokenTotals", () => {
  test("accumulates token counts from entry", () => {
    const state = createState()
    const entry = makeEntry({
      tokens: { input: 100, output: 50, total: 150 },
    })
    updateTokenTotals(state, entry)
    expect(state.tokenTotals.inputTokens).toBe(100)
    expect(state.tokenTotals.outputTokens).toBe(50)
    expect(state.tokenTotals.totalTokens).toBe(150)
  })

  test("accumulates across multiple calls", () => {
    const state = createState()
    updateTokenTotals(state, makeEntry({ tokens: { input: 10, output: 5, total: 15 } }))
    updateTokenTotals(state, makeEntry({ tokens: { input: 20, output: 10, total: 30 } }))
    expect(state.tokenTotals.inputTokens).toBe(30)
    expect(state.tokenTotals.outputTokens).toBe(15)
    expect(state.tokenTotals.totalTokens).toBe(45)
  })

  test("handles zero-token entries without mutation", () => {
    const state = createState()
    updateTokenTotals(state, makeEntry({ tokens: { input: 0, output: 0, total: 0 } }))
    expect(state.tokenTotals.inputTokens).toBe(0)
    expect(state.tokenTotals.outputTokens).toBe(0)
    expect(state.tokenTotals.totalTokens).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: combined state operations
// ---------------------------------------------------------------------------
describe("state operations integration", () => {
  test("full lifecycle: claim -> addRunning -> removeRunning -> release", () => {
    const state = createState()
    const config = makeConfig({ max_concurrent_agents: 2 })

    // Initial state: 2 slots available
    expect(availableSlots(state, config)).toBe(2)

    // Claim and start running
    claimIssue(state, "issue-1")
    const entry = makeEntry({ issueId: "issue-1" })
    addRunning(state, "issue-1", entry, makeHandle(entry))
    expect(availableSlots(state, config)).toBe(1)

    // Remove from running
    removeRunning(state, "issue-1")
    expect(availableSlots(state, config)).toBe(2)
    // Still claimed
    expect(state.claimed.has("issue-1")).toBe(true)

    // Full release
    releaseIssue(state, "issue-1")
    expect(state.claimed.has("issue-1")).toBe(false)
  })

  test("availableSlotsForState tracks correctly as issues come and go", () => {
    const state = createState()
    const config = makeConfig({
      max_concurrent_agents: 10,
      max_concurrent_agents_by_state: { todo: 2 },
    })

    // Start 2 Todo issues
    for (const id of ["a", "b"]) {
      const entry = makeEntry({ issueId: id, state: "Todo" })
      addRunning(state, id, entry, makeHandle(entry))
    }
    expect(availableSlotsForState(state, "Todo", config)).toBe(0)

    // Remove one
    removeRunning(state, "a")
    expect(availableSlotsForState(state, "Todo", config)).toBe(1)

    // Add an "In Progress" issue -- should not affect Todo count
    const ipEntry = makeEntry({ issueId: "c", state: "In Progress" })
    addRunning(state, "c", ipEntry, makeHandle(ipEntry))
    expect(availableSlotsForState(state, "Todo", config)).toBe(1)
  })
})
