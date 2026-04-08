import { describe, expect, test } from "bun:test"
import {
  detectEscalation,
  findParentRole,
  resolveEscalationTarget,
  createEscalatedResult,
} from "@/devilcode/workflow/escalation"
import type { TeamConfig } from "@/devilcode/team/config"

const teamConfig: TeamConfig = {
  enabled: true,
  roles: {
    orchestrator: {
      displayName: "Orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: [],
    },
    senior: {
      displayName: "Senior",
      provider: "openai",
      model: "gpt-5.4-codex",
      effort: "xhigh",
      tier: 2,
      canDelegate: ["worker"],
      maxConcurrent: 2,
      capabilities: [],
    },
    worker: {
      displayName: "Worker",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      effort: "default",
      tier: 3,
      canDelegate: [],
      maxConcurrent: 5,
      capabilities: [],
    },
  },
  routing: {
    strategy: "hierarchical",
    defaultRole: "worker",
    escalationEnabled: true,
  },
}

describe("detectEscalation", () => {
  test("returns no escalation for normal output", () => {
    const output = "Task completed successfully. Files modified: src/index.ts"
    const signal = detectEscalation(output)
    expect(signal.detected).toBe(false)
  })

  test("detects explicit escalation request", () => {
    const output = "I need to escalate this to the senior role. Reason: complex architecture decision required."
    const signal = detectEscalation(output)
    expect(signal.detected).toBe(true)
    expect(signal.suggestedRole).toBe("senior")
    expect(signal.reason).toContain("complex architecture decision")
  })

  test("detects outside expertise signal", () => {
    const output = "This is outside my expertise. I cannot handle security-related changes."
    const signal = detectEscalation(output)
    expect(signal.detected).toBe(true)
    expect(signal.reason).toBe("Task outside role expertise")
  })

  test("detects permission denied signal", () => {
    const output = "Permission denied. I cannot modify infrastructure files."
    const signal = detectEscalation(output)
    expect(signal.detected).toBe(true)
    expect(signal.reason).toBe("Insufficient permissions")
  })
})

describe("findParentRole", () => {
  test("finds orchestrator as parent of senior", () => {
    const parent = findParentRole("senior", teamConfig)
    expect(parent).toBe("orchestrator")
  })

  test("finds senior as parent of worker", () => {
    const parent = findParentRole("worker", teamConfig)
    expect(parent).toBe("senior")
  })

  test("returns undefined for top-level role", () => {
    const parent = findParentRole("orchestrator", teamConfig)
    expect(parent).toBeUndefined()
  })
})

describe("resolveEscalationTarget", () => {
  test("returns suggested role when valid", () => {
    const signal = { detected: true, reason: "Complex task", suggestedRole: "senior" }
    const target = resolveEscalationTarget("worker", signal, teamConfig)
    expect(target?.role).toBe("senior")
  })

  test("returns parent when no suggested role", () => {
    const signal = { detected: true, reason: "Need help" }
    const target = resolveEscalationTarget("worker", signal, teamConfig)
    expect(target?.role).toBe("senior")
  })
})

describe("createEscalatedResult", () => {
  test("creates result with escalated status", () => {
    const signal = { detected: true, reason: "Complex task" }
    const result = createEscalatedResult("task-1", "Some output", signal, ["file.ts"])

    expect(result.taskId).toBe("task-1")
    expect(result.status).toBe("escalated")
    expect(result.escalationReason).toBe("Complex task")
  })
})
