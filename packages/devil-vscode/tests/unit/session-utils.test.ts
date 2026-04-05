import { describe, it, expect } from "bun:test"
import {
  computeStatus,
  calcTotalCost,
  calcContextUsage,
  buildFamilyCosts,
  buildFamilyLabels,
  buildCostBreakdown,
} from "../../webview-ui/src/context/session-utils"
import type { Part } from "../../webview-ui/src/types/messages"

const t = (key: string) => key

describe("computeStatus", () => {
  it("returns undefined for undefined part", () => {
    expect(computeStatus(undefined, t)).toBeUndefined()
  })

  it("maps task tool to delegating status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "task", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.delegating")
  })

  it("maps todowrite tool to planning status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "todowrite", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.planning")
  })

  it("maps todoread tool to planning status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "todoread", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.planning")
  })

  it("maps read tool to gatheringContext status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "read", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.gatheringContext")
  })

  it("maps list/grep/glob tools to searchingCodebase status", () => {
    for (const tool of ["list", "grep", "glob"] as const) {
      const part: Part = { type: "tool", id: "p1", tool, state: { status: "running", input: {} } }
      expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.searchingCodebase")
    }
  })

  it("maps webfetch tool to searchingWeb status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "webfetch", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.searchingWeb")
  })

  it("maps edit/write tools to makingEdits status", () => {
    for (const tool of ["edit", "write"] as const) {
      const part: Part = { type: "tool", id: "p1", tool, state: { status: "running", input: {} } }
      expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.makingEdits")
    }
  })

  it("maps bash tool to runningCommands status", () => {
    const part: Part = { type: "tool", id: "p1", tool: "bash", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.runningCommands")
  })

  it("returns undefined for unknown tool", () => {
    const part: Part = { type: "tool", id: "p1", tool: "unknown_tool", state: { status: "running", input: {} } }
    expect(computeStatus(part, t)).toBeUndefined()
  })

  it("maps reasoning part to thinking status", () => {
    const part: Part = { type: "reasoning", id: "p1", text: "thinking..." }
    expect(computeStatus(part, t)).toBe("ui.sessionTurn.status.thinking")
  })

  it("maps text part to writingResponse status", () => {
    const part: Part = { type: "text", id: "p1", text: "hello" }
    expect(computeStatus(part, t)).toBe("session.status.writingResponse")
  })
})

describe("calcTotalCost", () => {
  it("returns 0 for empty messages", () => {
    expect(calcTotalCost([])).toBe(0)
  })

  it("sums costs from assistant messages only", () => {
    const msgs = [
      { role: "user", cost: 1 },
      { role: "assistant", cost: 0.05 },
      { role: "assistant", cost: 0.03 },
    ]
    expect(calcTotalCost(msgs)).toBeCloseTo(0.08)
  })

  it("ignores user messages", () => {
    const msgs = [
      { role: "user", cost: 999 },
      { role: "assistant", cost: 0.01 },
    ]
    expect(calcTotalCost(msgs)).toBeCloseTo(0.01)
  })

  it("handles missing cost as 0", () => {
    const msgs = [{ role: "assistant" }, { role: "assistant", cost: 0.02 }]
    expect(calcTotalCost(msgs)).toBeCloseTo(0.02)
  })
})

describe("calcContextUsage", () => {
  it("sums all token types", () => {
    const tokens = { input: 100, output: 50, reasoning: 20, cache: { read: 10, write: 5 } }
    const result = calcContextUsage(tokens, undefined)
    expect(result.tokens).toBe(185)
  })

  it("returns null percentage when no context limit", () => {
    const result = calcContextUsage({ input: 100, output: 50 }, undefined)
    expect(result.percentage).toBeNull()
  })

  it("calculates percentage correctly", () => {
    const result = calcContextUsage({ input: 1000, output: 1000 }, 4000)
    expect(result.percentage).toBe(50)
  })

  it("rounds percentage to integer", () => {
    const result = calcContextUsage({ input: 1, output: 2 }, 3)
    expect(Number.isInteger(result.percentage)).toBe(true)
  })

  it("handles missing optional fields as 0", () => {
    const result = calcContextUsage({ input: 100, output: 0 }, 1000)
    expect(result.tokens).toBe(100)
    expect(result.percentage).toBe(10)
  })
})

// ── Cost breakdown helpers ──────────────────────────────────────────────

function msg(id: string, role: string, cost?: number) {
  return { id, role, cost }
}

function toolPart(tool: string, sessionId?: string, input?: { subagent_type?: string; description?: string }) {
  return {
    type: "tool" as const,
    tool,
    state: {
      input: input ?? {},
      metadata: sessionId ? { sessionId } : {},
    },
  }
}

describe("buildFamilyCosts", () => {
  it("returns empty map for empty family", () => {
    expect(buildFamilyCosts(new Set(), {}).size).toBe(0)
  })

  it("sums costs per session, skipping zero-cost sessions", () => {
    const family = new Set(["s1", "s2", "s3"])
    const messages = {
      s1: [msg("m1", "assistant", 0.05), msg("m2", "assistant", 0.03)],
      s2: [msg("m3", "user", 999), msg("m4", "assistant", 0)],
      s3: [msg("m5", "assistant", 0.1)],
    }
    const costs = buildFamilyCosts(family, messages)
    expect(costs.size).toBe(2)
    expect(costs.get("s1")).toBeCloseTo(0.08)
    expect(costs.has("s2")).toBe(false)
    expect(costs.get("s3")).toBeCloseTo(0.1)
  })

  it("handles missing messages for a family member", () => {
    const family = new Set(["s1", "s2"])
    const messages = { s1: [msg("m1", "assistant", 0.01)] }
    const costs = buildFamilyCosts(family, messages)
    expect(costs.size).toBe(1)
    expect(costs.get("s1")).toBeCloseTo(0.01)
  })
})

describe("buildFamilyLabels", () => {
  it("returns empty map when no task tool parts exist", () => {
    const family = new Set(["s1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = { m1: [{ type: "text" }] }
    expect(buildFamilyLabels(family, messages as any, parts as any).size).toBe(0)
  })

  it("extracts label from subagent_type", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [toolPart("task", "child1", { subagent_type: "explore" })],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.get("child1")).toBe("explore")
  })

  it("falls back to description when subagent_type is absent", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [toolPart("task", "child1", { description: "Fix the bug" })],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.get("child1")).toBe("Fix the bug")
  })

  it("falls back to tool name when no input fields", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [toolPart("task", "child1")],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.get("child1")).toBe("task")
  })

  it("truncates labels longer than 24 chars", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [toolPart("task", "child1", { description: "A very long description that exceeds the cap" })],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    const label = labels.get("child1")!
    expect(label.length).toBeLessThanOrEqual(24)
    expect(label.endsWith("…")).toBe(true)
  })

  it("ignores child sessions not in the family set", () => {
    const family = new Set(["s1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [toolPart("task", "orphan", { subagent_type: "general" })],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.size).toBe(0)
  })

  it("uses first label when multiple parts reference same child", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant"), msg("m2", "assistant")] }
    const parts = {
      m1: [toolPart("task", "child1", { subagent_type: "first" })],
      m2: [toolPart("task", "child1", { subagent_type: "second" })],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.get("child1")).toBe("first")
  })
})

describe("buildCostBreakdown", () => {
  it("returns empty array for empty costs", () => {
    expect(buildCostBreakdown("s1", new Map(), new Map(), "This session")).toEqual([])
  })

  it("labels root session with the provided rootLabel", () => {
    const costs = new Map([["s1", 0.05]])
    const result = buildCostBreakdown("s1", costs, new Map(), "This session")
    expect(result).toEqual([{ label: "This session", cost: 0.05 }])
  })

  it("labels child sessions from the labels map", () => {
    const costs = new Map<string, number>([
      ["s1", 0.05],
      ["child1", 0.03],
    ])
    const labels = new Map([["child1", "explore"]])
    const result = buildCostBreakdown("s1", costs, labels, "This session")
    expect(result).toEqual([
      { label: "This session", cost: 0.05 },
      { label: "explore", cost: 0.03 },
    ])
  })

  it("falls back to truncated session ID for unlabeled children", () => {
    const costs = new Map<string, number>([
      ["s1", 0.05],
      ["abcdef1234567890", 0.02],
    ])
    const result = buildCostBreakdown("s1", costs, new Map(), "This session")
    expect(result[1].label).toBe("abcdef12")
  })
})
