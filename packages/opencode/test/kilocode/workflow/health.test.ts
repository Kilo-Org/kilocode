import { describe, test, expect } from "bun:test"
import {
  type HealthConfig,
  type HealthAlert,
  DEFAULT_HEALTH_CONFIG,
  detectStuckTasks,
  detectDeadlock,
} from "@/devilcode/workflow/health"
import type { ActiveTask } from "@/devilcode/workflow/types"

describe("detectStuckTasks", () => {
  test("detects task stuck for longer than threshold", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 20 * 60 * 1000]]) // 20 min ago
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "in_progress" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].taskId).toBe("T-001")
    expect(alerts[0].reason).toContain("no activity")
  })

  test("ignores active task within threshold", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 5 * 60 * 1000]]) // 5 min ago
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "in_progress" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(0)
  })

  test("ignores completed tasks", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 60 * 60 * 1000]])
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "completed" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(0)
  })
})

describe("detectDeadlock", () => {
  test("detects cycle", () => {
    // A depends on B, B depends on A, both blocked
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "blocked" },
      { id: "B", role: "worker", status: "blocked" },
    ]
    const deps = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["A"]],
    ])
    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cycle")
    expect(result!.taskIds).toContain("A")
    expect(result!.taskIds).toContain("B")
  })

  test("detects all-blocked cascade", () => {
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "blocked" },
      { id: "B", role: "worker", status: "blocked" },
    ]
    // A depends on C (which doesn't exist / failed), B depends on A
    const deps = new Map<string, string[]>([
      ["A", ["C"]],
      ["B", ["A"]],
    ])
    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cascade")
  })

  test("no deadlock when tasks are progressing", () => {
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "in_progress" },
      { id: "B", role: "worker", status: "pending" },
    ]
    const deps = new Map<string, string[]>([["B", ["A"]]])
    const result = detectDeadlock(tasks, deps)
    expect(result).toBeNull()
  })
})
