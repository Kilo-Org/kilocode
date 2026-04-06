import { describe, expect, test, beforeEach } from "bun:test"
import { ConcurrencyManager } from "@/devilcode/team/concurrency"

describe("ConcurrencyManager", () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    manager = new ConcurrencyManager()
  })

  test("acquire and release a slot", () => {
    manager.acquire("worker", "task-1")
    expect(manager.getActiveCount("worker")).toBe(1)
    manager.release("worker", "task-1")
    expect(manager.getActiveCount("worker")).toBe(0)
  })

  test("tracks multiple tasks per role", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("worker", "task-2")
    manager.acquire("worker", "task-3")
    expect(manager.getActiveCount("worker")).toBe(3)
  })

  test("tracks roles independently", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("senior", "task-2")
    expect(manager.getActiveCount("worker")).toBe(1)
    expect(manager.getActiveCount("senior")).toBe(1)
  })

  test("returns 0 for unknown role", () => {
    expect(manager.getActiveCount("nonexistent")).toBe(0)
  })

  test("release is idempotent for unknown task", () => {
    manager.release("worker", "nonexistent")
    expect(manager.getActiveCount("worker")).toBe(0)
  })

  test("hasCapacity returns true when under limit", () => {
    manager.acquire("worker", "task-1")
    expect(manager.hasCapacity("worker", 5)).toBe(true)
  })

  test("hasCapacity returns false when at limit", () => {
    for (let i = 0; i < 5; i++) {
      manager.acquire("worker", `task-${i}`)
    }
    expect(manager.hasCapacity("worker", 5)).toBe(false)
  })

  test("hasCapacity returns true after release frees a slot", () => {
    for (let i = 0; i < 5; i++) {
      manager.acquire("worker", `task-${i}`)
    }
    expect(manager.hasCapacity("worker", 5)).toBe(false)
    manager.release("worker", "task-0")
    expect(manager.hasCapacity("worker", 5)).toBe(true)
  })

  test("getActiveTasks returns task IDs for a role", () => {
    manager.acquire("senior", "task-a")
    manager.acquire("senior", "task-b")
    const tasks = manager.getActiveTasks("senior")
    expect(tasks).toContain("task-a")
    expect(tasks).toContain("task-b")
    expect(tasks.length).toBe(2)
  })

  test("reset clears all state", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("senior", "task-2")
    manager.reset()
    expect(manager.getActiveCount("worker")).toBe(0)
    expect(manager.getActiveCount("senior")).toBe(0)
  })
})
