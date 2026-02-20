import { describe, it, expect } from "bun:test"
import { computeStatus, calcTotalCost, calcContextUsage } from "../../webview-ui/src/context/session-utils"
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
