/**
 * Task cleanup classification tests. Exercises the pure logic in
 * src/services/task-cleanup/classify.ts — the same function the
 * TaskCleanupService uses to decide which sessions to delete.
 */

import { describe, it, expect } from "bun:test"
import {
  DAY_MS,
  clampDays,
  deletionRoots,
  expiredSessions,
  type CleanupSession,
} from "../../src/services/task-cleanup/classify"

const NOW = 1_700_000_000_000

function session(id: string, ageDays: number, overrides: Partial<CleanupSession> = {}): CleanupSession {
  const updated = NOW - ageDays * DAY_MS
  return {
    id,
    directory: "/repo",
    created: updated - 60_000,
    updated,
    ...overrides,
  }
}

const retention = { defaultDays: 30, incompleteDays: 7 }

describe("expiredSessions", () => {
  it("expires regular sessions past the default retention", () => {
    const fresh = session("fresh", 5)
    const old = session("old", 31)
    const result = expiredSessions([fresh, old], retention, NOW)
    expect(result.has("old")).toBe(true)
    expect(result.has("fresh")).toBe(false)
  })

  it("keeps sessions just inside the boundary, expires at it", () => {
    const inside = session("inside", 29.9)
    expect(expiredSessions([inside], retention, NOW).has("inside")).toBe(false)
    const edge = session("edge", 30)
    expect(expiredSessions([edge], retention, NOW).has("edge")).toBe(true)
  })

  it("expires abandoned stub sessions on the shorter clock", () => {
    // Lifetime under a minute: never ran a real exchange.
    const stub = session("stub", 8, { created: NOW - 8 * DAY_MS - 30_000, updated: NOW - 8 * DAY_MS })
    expect(expiredSessions([stub], retention, NOW).has("stub")).toBe(true)

    const youngStub = session("young-stub", 3, { created: NOW - 3 * DAY_MS - 30_000, updated: NOW - 3 * DAY_MS })
    expect(expiredSessions([youngStub], retention, NOW).has("young-stub")).toBe(false)

    // A real session of the same age survives the 7-day clock.
    const real = session("real", 8)
    expect(expiredSessions([real], retention, NOW).has("real")).toBe(false)
  })

  it("protects an old parent while a fork is still fresh", () => {
    const parent = session("parent", 40)
    const child = session("child", 2, { parentID: "parent" })
    const result = expiredSessions([parent, child], retention, NOW)
    expect(result.has("parent")).toBe(false)
    expect(result.has("child")).toBe(false)
  })

  it("expires a parent and fork once both age out", () => {
    const parent = session("parent", 40)
    const child = session("child", 35, { parentID: "parent" })
    const result = expiredSessions([parent, child], retention, NOW)
    expect(result.has("parent")).toBe(true)
    expect(result.has("child")).toBe(true)
  })

  it("protects a grandparent through a chain of fresh forks", () => {
    const grand = session("grand", 60)
    const parent = session("parent", 40, { parentID: "grand" })
    const child = session("child", 1, { parentID: "parent" })
    const result = expiredSessions([grand, parent, child], retention, NOW)
    expect(result.has("grand")).toBe(false)
    expect(result.has("parent")).toBe(false)
  })

  it("does not loop on cyclic parent links", () => {
    const a = session("a", 40, { parentID: "b" })
    const b = session("b", 40, { parentID: "a" })
    const result = expiredSessions([a, b], retention, NOW)
    expect(result.has("a")).toBe(true)
    expect(result.has("b")).toBe(true)
  })

  it("handles sessions from multiple directories", () => {
    const x = session("x", 31, { directory: "/one" })
    const y = session("y", 31, { directory: "/two" })
    const result = expiredSessions([x, y], retention, NOW)
    expect(result.size).toBe(2)
  })
})

describe("deletionRoots", () => {
  const parent = session("parent", 40)
  const child = session("child", 35, { parentID: "parent" })
  const grand = session("grand", 40)
  const mid = session("mid", 38, { parentID: "grand" })
  const leaf = session("leaf", 36, { parentID: "mid" })
  const freshParent = session("fresh-parent", 2)
  const orphanChild = session("orphan-child", 35, { parentID: "fresh-parent" })
  const sessions = [parent, child, grand, mid, leaf, freshParent, orphanChild]

  const rootIds = (expired: string[]) => deletionRoots(sessions, new Set(expired)).map((s) => s.id)

  it("keeps only the topmost expired id of a chain", () => {
    expect(rootIds(["parent", "child", "grand", "mid", "leaf"])).toEqual(["parent", "grand"])
  })

  it("keeps an expired child whose parent is not expired", () => {
    expect(rootIds(["orphan-child"])).toEqual(["orphan-child"])
  })

  it("drops cascaded descendants even when only a middle link is checked", () => {
    // grand is fresh, so mid is the root; leaf cascades with mid
    expect(rootIds(["mid", "leaf"])).toEqual(["mid"])
  })

  it("terminates on cyclic parent links", () => {
    const a = session("a", 40, { parentID: "b" })
    const b = session("b", 40, { parentID: "a" })
    expect(deletionRoots([a, b], new Set(["a", "b"]))).toEqual([])
  })
})

describe("clampDays", () => {
  it("accepts whole days at or above one", () => {
    expect(clampDays(1, 30)).toBe(1)
    expect(clampDays(45, 30)).toBe(45)
    expect(clampDays(7.9, 30)).toBe(7)
  })

  it("falls back on invalid input", () => {
    expect(clampDays(0, 30)).toBe(30)
    expect(clampDays(-5, 7)).toBe(7)
    expect(clampDays(Number.NaN, 30)).toBe(30)
    expect(clampDays("30", 30)).toBe(30)
    expect(clampDays(undefined, 7)).toBe(7)
  })
})
