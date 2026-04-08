import { describe, test, expect } from "bun:test"
import { detectStuckTasks, DEFAULT_HEALTH_CONFIG, type HealthConfig } from "@/devilcode/workflow/health"
import type { ActiveTask } from "@/devilcode/workflow/types"

describe("W9: detectStuckTasks uses different thresholds by status", () => {
  test("blocked tasks use reviewStuckTimeoutMs, in_progress uses taskStuckTimeoutMs", () => {
    const config: HealthConfig = {
      taskStuckTimeoutMs: 10 * 60 * 1000,
      reviewStuckTimeoutMs: 5 * 60 * 1000,
      mergeStuckTimeoutMs: 2 * 60 * 1000,
    }
    const now = Date.now()
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "in_progress" },
      { id: "T-002", role: "worker", status: "blocked" },
    ]
    const lastActivity = new Map<string, number>()
    lastActivity.set("T-001", now - 7 * 60 * 1000)
    lastActivity.set("T-002", now - 7 * 60 * 1000)

    const alerts = detectStuckTasks(tasks, lastActivity, config, now)

    expect(alerts.find((a) => a.taskId === "T-001")).toBeUndefined()
    expect(alerts.find((a) => a.taskId === "T-002")).toBeDefined()
  })
})
