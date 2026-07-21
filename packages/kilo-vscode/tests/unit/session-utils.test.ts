import { describe, it, expect } from "bun:test"
import {
  computeStatus,
  calcTotalCost,
  calcContextUsage,
  calcTokenUsage,
  aggregateMetrics,
  messageMetrics,
  formatPP,
  formatTG,
  buildFamilyCosts,
  buildFamilyParents,
  buildFamilyParentsFromTools,
  buildFamilyLabels,
  buildFamilyLabelsFromTools,
  buildCostBreakdown,
  buildSessionToolParts,
  collapseCostBreakdown,
  childID,
  removeSessionToolPart,
  removeSessionToolPartsForMessage,
  upsertSessionToolPart,
  recentSessions,
} from "../../webview-ui/src/context/session-utils"
import type { Message, Part, ToolPart } from "../../webview-ui/src/types/messages"

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

  it("maps synthetic snapshot progress to snapshot status", () => {
    const part: Part = { type: "text", id: "p1", text: "⠋ Initializing snapshot…", synthetic: true }
    expect(computeStatus(part, t)).toBe("Initializing snapshot...")
  })
})

describe("recentSessions", () => {
  const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`
  const info = (id: string, day: number, parentID?: string | null) => ({
    id,
    updatedAt: at(day),
    ...(parentID === undefined ? {} : { parentID }),
  })

  it("keeps the newest root sessions after removing sub-agents", () => {
    const result = recentSessions([
      info("old-root", 1),
      info("child", 6, "old-root"),
      info("new-root", 5),
      info("blank-parent", 4, ""),
      info("mid-root", 3, null),
      info("fourth-root", 2),
    ])

    expect(result.map((session) => session.id)).toEqual(["new-root", "mid-root", "fourth-root"])
  })

  it("does not mutate the session list while sorting recents", () => {
    const sessions = [info("old", 1), info("new", 3), info("mid", 2)]

    recentSessions(sessions)

    expect(sessions.map((session) => session.id)).toEqual(["old", "new", "mid"])
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

describe("calcTokenUsage", () => {
  it("sums assistant message input, output, and cache read tokens", () => {
    const result = calcTokenUsage([
      { role: "assistant", tokens: { input: 100, output: 40, reasoning: 8, cache: { read: 10, write: 5 } } },
      { role: "assistant", tokens: { input: 25, output: 15, cache: { read: 7, write: 3 } } },
    ])

    expect(result).toEqual({ input: 125, output: 55, cached: 17 })
  })

  it("ignores user messages, missing tokens, reasoning tokens, and cache writes", () => {
    const result = calcTokenUsage([
      { role: "user", tokens: { input: 999, output: 999, cache: { read: 999, write: 999 } } },
      { role: "assistant" },
      { role: "assistant", tokens: { input: 10, output: 4, reasoning: 30, cache: { read: 2, write: 20 } } },
    ])

    expect(result).toEqual({ input: 10, output: 4, cached: 2 })
  })

  it("returns undefined when there are no displayed token counts", () => {
    const result = calcTokenUsage([
      { role: "assistant", tokens: { input: 0, output: 0, reasoning: 12, cache: { read: 0, write: 6 } } },
    ])

    expect(result).toBeUndefined()
  })
})

// ── Cost breakdown helpers ──────────────────────────────────────────────

function msg(id: string, role: string, cost?: number) {
  return { id, role, cost }
}

function toolPart(tool: string, sessionId?: string, input?: { subagent_type?: string; description?: string }) {
  return {
    id: `part-${tool}-${sessionId ?? "none"}`,
    type: "tool" as const,
    tool,
    state: {
      input: input ?? {},
      metadata: sessionId ? { sessionId } : {},
    },
  }
}

function textPart(id: string, text = "text"): Part {
  return { id, type: "text" as const, text }
}

function indexMsg(id: string, role: "user" | "assistant", parts?: Part[]): Message {
  return { id, role, sessionID: "s1", createdAt: id, parts }
}

describe("childID", () => {
  it("reads session ID from top-level metadata", () => {
    expect(childID({ type: "tool", tool: "task", metadata: { sessionId: "child1" } })).toBe("child1")
  })

  it("reads session ID from state metadata", () => {
    expect(childID({ type: "tool", tool: "task", state: { metadata: { sessionId: "child2" } } })).toBe("child2")
  })

  it("prefers top-level metadata over state metadata", () => {
    expect(
      childID({
        type: "tool",
        tool: "task",
        metadata: { sessionId: "top" },
        state: { metadata: { sessionId: "nested" } },
      }),
    ).toBe("top")
  })

  it("ignores non-task tool parts", () => {
    expect(childID({ type: "tool", tool: "read", state: { metadata: { sessionId: "child3" } } })).toBeUndefined()
  })
})

describe("buildFamilyCosts", () => {
  it("returns empty map for empty family", () => {
    expect(buildFamilyCosts(new Set(), {}, {}).size).toBe(0)
  })

  it("returns own-cost per session when there are no parent links", () => {
    const family = new Set(["s1", "s2", "s3"])
    const messages = {
      s1: [msg("m1", "assistant", 0.05), msg("m2", "assistant", 0.03)],
      s2: [msg("m3", "user", 999), msg("m4", "assistant", 0)],
      s3: [msg("m5", "assistant", 0.1)],
    }
    const sessions = { s1: {}, s2: {}, s3: {} }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.size).toBe(2)
    expect(costs.get("s1")).toBeCloseTo(0.08)
    expect(costs.has("s2")).toBe(false)
    expect(costs.get("s3")).toBeCloseTo(0.1)
  })

  it("subtracts each subagent's propagated total from its parent (single child)", () => {
    // Backend contract: parent's message.info.cost already includes the
    // child's total. Parent total $0.15 = parent own $0.05 + child $0.10.
    const family = new Set(["root", "child"])
    const messages = {
      root: [msg("m1", "assistant", 0.15)],
      child: [msg("m2", "assistant", 0.1)],
    }
    const sessions = { root: {}, child: { parentID: "root" } }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.get("root")).toBeCloseTo(0.05)
    expect(costs.get("child")).toBeCloseTo(0.1)
    // Sum of own-costs equals root's propagated total.
    const sum = [...costs.values()].reduce((s, c) => s + c, 0)
    expect(sum).toBeCloseTo(0.15)
  })

  it("subtracts every direct child from a parent with multiple subagents", () => {
    // Parent total $0.18 = parent own $0.05 + childA $0.10 + childB $0.03.
    const family = new Set(["root", "a", "b"])
    const messages = {
      root: [msg("m1", "assistant", 0.18)],
      a: [msg("m2", "assistant", 0.1)],
      b: [msg("m3", "assistant", 0.03)],
    }
    const sessions = { root: {}, a: { parentID: "root" }, b: { parentID: "root" } }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.get("root")).toBeCloseTo(0.05)
    expect(costs.get("a")).toBeCloseTo(0.1)
    expect(costs.get("b")).toBeCloseTo(0.03)
    const sum = [...costs.values()].reduce((s, c) => s + c, 0)
    expect(sum).toBeCloseTo(0.18)
  })

  it("handles nested subagents (grandchildren) correctly", () => {
    // root.total = root_own + child.total; child.total = child_own + grandchild.total.
    // root.total = $0.05 + ($0.06 + $0.04) = $0.15.
    const family = new Set(["root", "child", "grand"])
    const messages = {
      root: [msg("m1", "assistant", 0.15)],
      child: [msg("m2", "assistant", 0.1)],
      grand: [msg("m3", "assistant", 0.04)],
    }
    const sessions = {
      root: {},
      child: { parentID: "root" },
      grand: { parentID: "child" },
    }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.get("root")).toBeCloseTo(0.05)
    expect(costs.get("child")).toBeCloseTo(0.06)
    expect(costs.get("grand")).toBeCloseTo(0.04)
    const sum = [...costs.values()].reduce((s, c) => s + c, 0)
    expect(sum).toBeCloseTo(0.15)
  })

  it("drops sessions whose own-cost rounds to zero (pure dispatcher)", () => {
    // Wrapper session that only spawned a subagent with no LLM calls of its own.
    const family = new Set(["root", "child"])
    const messages = {
      root: [msg("m1", "assistant", 0.1)],
      child: [msg("m2", "assistant", 0.1)],
    }
    const sessions = { root: {}, child: { parentID: "root" } }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.has("root")).toBe(false)
    expect(costs.get("child")).toBeCloseTo(0.1)
  })

  it("ignores parent links that point outside the family", () => {
    const family = new Set(["s1"])
    const messages = { s1: [msg("m1", "assistant", 0.07)] }
    const sessions = { s1: { parentID: "not-in-family" } }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.get("s1")).toBeCloseTo(0.07)
  })

  it("handles missing messages for a family member", () => {
    const family = new Set(["s1", "s2"])
    const messages = { s1: [msg("m1", "assistant", 0.01)] }
    const sessions = { s1: {}, s2: { parentID: "s1" } }
    const costs = buildFamilyCosts(family, messages, sessions)
    expect(costs.size).toBe(1)
    expect(costs.get("s1")).toBeCloseTo(0.01)
  })

  it("subtracts child totals using task parent links when session metadata is missing", () => {
    const family = new Set(["root", "child"])
    const messages = {
      root: [msg("m1", "assistant", 0.15)],
      child: [msg("m2", "assistant", 0.1)],
    }
    const parts = { m1: [toolPart("task", "child", { subagent_type: "explore" })] }
    const parents = buildFamilyParents(family, messages, parts)
    const costs = buildFamilyCosts(family, messages, { root: {} }, parents)
    expect(costs.get("root")).toBeCloseTo(0.05)
    expect(costs.get("child")).toBeCloseTo(0.1)
  })

  it("returns own costs for a nested propagated subagent chain", () => {
    const ids = ["root", "a", "b", "c"]
    const own = new Map<string, number>([
      ["root", 1],
      ["a", 2],
      ["b", 3],
      ["c", 4],
    ])
    const total = ids.reduce((sum, sid) => sum + own.get(sid)!, 0)
    const subtree = (index: number) => ids.slice(index).reduce((sum, sid) => sum + own.get(sid)!, 0)
    const messages = Object.fromEntries(ids.map((sid, index) => [sid, [msg(`m-${sid}`, "assistant", subtree(index))]]))
    const sessions = Object.fromEntries(ids.map((sid, index) => [sid, index === 0 ? {} : { parentID: ids[index - 1] }]))

    const costs = buildFamilyCosts(new Set(ids), messages, sessions)
    const sum = [...costs.values()].reduce((acc, cost) => acc + cost, 0)
    const bad = ids.reduce((acc, _sid, index) => acc + subtree(index), 0)

    expect(bad).toBe(30)
    expect(costs.get("root")).toBe(1)
    expect(costs.get("a")).toBe(2)
    expect(costs.get("b")).toBe(3)
    expect(costs.get("c")).toBe(4)
    expect(sum).toBe(total)
  })

  it("returns own costs for a nested chain using task-derived parent links", () => {
    const ids = ["root", "a", "b", "c"]
    const own = { root: 1, a: 2, b: 3, c: 4 }
    const subtree = (index: number) => ids.slice(index).reduce((sum, sid) => sum + own[sid as keyof typeof own], 0)
    const messages = Object.fromEntries(ids.map((sid, index) => [sid, [msg(`m-${sid}`, "assistant", subtree(index))]]))
    const parts = Object.fromEntries(
      ids
        .slice(0, -1)
        .map((sid, index) => [`m-${sid}`, [toolPart("task", ids[index + 1], { subagent_type: "explore" })]]),
    )
    const parents = buildFamilyParents(new Set(ids), messages, parts)
    const costs = buildFamilyCosts(new Set(ids), messages, { root: {} }, parents)
    const sum = [...costs.values()].reduce((acc, cost) => acc + cost, 0)

    expect(parents.size).toBe(3)
    expect(costs.get("root")).toBe(1)
    expect(costs.get("a")).toBe(2)
    expect(costs.get("b")).toBe(3)
    expect(costs.get("c")).toBe(4)
    expect(sum).toBe(10)
  })
})

describe("buildFamilyParents", () => {
  it("derives child-to-parent links from task tool parts", () => {
    const family = new Set(["root", "child"])
    const messages = { root: [msg("m1", "assistant")], child: [msg("m2", "assistant")] }
    const parts = { m1: [toolPart("task", "child", { subagent_type: "general" })] }
    const parents = buildFamilyParents(family, messages, parts)
    expect(parents.get("child")).toBe("root")
  })

  it("ignores task parts that point outside the family", () => {
    const family = new Set(["root"])
    const messages = { root: [msg("m1", "assistant")] }
    const parts = { m1: [toolPart("task", "orphan", { subagent_type: "general" })] }
    expect(buildFamilyParents(family, messages, parts).size).toBe(0)
  })
})

describe("session tool indexes", () => {
  it("builds tool parts in assistant message order", () => {
    const messages = [
      indexMsg("u1", "user", [toolPart("read") as ToolPart]),
      indexMsg("a1", "assistant", [toolPart("read") as ToolPart, textPart("t1")]),
      indexMsg("a2", "assistant", [toolPart("grep") as ToolPart]),
    ]
    const tools = buildSessionToolParts(messages)
    expect(tools.map((part) => part.tool)).toEqual(["read", "grep"])
    expect(tools.map((part) => part.messageID)).toEqual(["a1", "a2"])
  })

  it("uses a lookup so stashed loaded parts can feed the index", () => {
    const messages = [indexMsg("a1", "assistant")]
    const parts: Record<string, Part[]> = { a1: [toolPart("websearch") as ToolPart, textPart("t1")] }
    const tools = buildSessionToolParts(messages, (item) => parts[item.id])
    expect(tools.map((part) => part.tool)).toEqual(["websearch"])
  })

  it("upserts tool parts without duplicating and ignores text deltas", () => {
    const first = { ...toolPart("bash"), id: "p1", state: { status: "running", input: {}, title: "old" } }
    const next = { ...toolPart("bash"), id: "p1", state: { status: "running", input: {}, title: "new" } }
    const indexed = upsertSessionToolPart([], first as ToolPart, { id: "m1", sessionID: "s1" })
    const updated = upsertSessionToolPart(indexed, next as ToolPart, { id: "m1", sessionID: "s1" })
    const text = upsertSessionToolPart(updated, textPart("t1"), { id: "m1", sessionID: "s1" })
    expect(text).toHaveLength(1)
    expect((text[0]!.state as { title?: string }).title).toBe("new")
  })

  it("removes indexed tools by part or message", () => {
    const first = upsertSessionToolPart([], { ...toolPart("read"), id: "p1" } as ToolPart, {
      id: "m1",
      sessionID: "s1",
    })
    const second = upsertSessionToolPart(first, { ...toolPart("grep"), id: "p2" } as ToolPart, {
      id: "m2",
      sessionID: "s1",
    })
    expect(removeSessionToolPart(second, "p1").map((part) => part.id)).toEqual(["p2"])
    expect(removeSessionToolPartsForMessage(second, "m2").map((part) => part.id)).toEqual(["p1"])
  })

  it("derives parents and labels from indexed tool parts", () => {
    const family = new Set(["root", "child"])
    const tools = new Map([
      ["root", [toolPart("task", "child", { subagent_type: "explore" })]],
      ["child", []],
    ])
    const parents = buildFamilyParentsFromTools(family, (sid) => tools.get(sid) ?? [])
    const labels = buildFamilyLabelsFromTools(family, (sid) => tools.get(sid) ?? [])
    expect(parents.get("child")).toBe("root")
    expect(labels.get("child")).toBe("explore")
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

  it("extracts labels when session ID is top-level metadata", () => {
    const family = new Set(["s1", "child1"])
    const messages = { s1: [msg("m1", "assistant")] }
    const parts = {
      m1: [
        {
          type: "tool" as const,
          tool: "task",
          metadata: { sessionId: "child1" },
          state: { input: { subagent_type: "general" } },
        },
      ],
    }
    const labels = buildFamilyLabels(family, messages as any, parts as any)
    expect(labels.get("child1")).toBe("general")
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

// ── collapseCostBreakdown ───────────────────────────────────────────────

const summary = (n: number) => `${n} older sessions`

describe("collapseCostBreakdown", () => {
  it("returns items unchanged when there is only one entry", () => {
    const items = [{ label: "This session", cost: 0.1 }]
    expect(collapseCostBreakdown(items, summary)).toEqual(items)
  })

  it("returns items unchanged for empty array", () => {
    expect(collapseCostBreakdown([], summary)).toEqual([])
  })

  it("shows all children in reverse order when count is small (snapshot: few subagents)", () => {
    const items = [
      { label: "This session", cost: 0.1 },
      { label: "explore", cost: 0.02 },
      { label: "general", cost: 0.03 },
      { label: "docs", cost: 0.01 },
    ]
    expect(collapseCostBreakdown(items, summary)).toEqual([
      { label: "This session", cost: 0.1 },
      { label: "docs", cost: 0.01 },
      { label: "general", cost: 0.03 },
      { label: "explore", cost: 0.02 },
    ])
  })

  it("shows root + 8 reversed children when exactly 8 children", () => {
    const items = [
      { label: "This session", cost: 0.5 },
      ...Array.from({ length: 8 }, (_, i) => ({ label: `child-${i + 1}`, cost: 0.01 * (i + 1) })),
    ]
    const result = collapseCostBreakdown(items, summary)
    expect(result.length).toBe(9)
    expect(result[0].label).toBe("This session")
    expect(result[1].label).toBe("child-8")
    expect(result[8].label).toBe("child-1")
  })

  it("aggregates older sessions when children exceed 8 (snapshot: many subagents)", () => {
    const items = [
      { label: "This session", cost: 0.5 },
      ...Array.from({ length: 15 }, (_, i) => ({ label: `agent-${i + 1}`, cost: 0.01 * (i + 1) })),
    ]
    const result = collapseCostBreakdown(items, summary)

    // root + 8 visible + 1 aggregated = 10 entries
    expect(result.length).toBe(10)

    // root stays first
    expect(result[0]).toEqual({ label: "This session", cost: 0.5 })

    // most recent 8 children in reverse order
    expect(result[1].label).toBe("agent-15")
    expect(result[2].label).toBe("agent-14")
    expect(result[8].label).toBe("agent-8")

    // aggregated summary for the 7 oldest children (agent-1 through agent-7)
    const aggregated = result[9]
    expect(aggregated.label).toBe("7 older sessions")
    const expected = 0.01 + 0.02 + 0.03 + 0.04 + 0.05 + 0.06 + 0.07
    expect(aggregated.cost).toBeCloseTo(expected)
  })

  it("aggregates with 20 children (snapshot: large count)", () => {
    const items = [
      { label: "This session", cost: 1.0 },
      ...Array.from({ length: 20 }, (_, i) => ({ label: `sub-${i + 1}`, cost: 0.05 })),
    ]
    const result = collapseCostBreakdown(items, summary)

    expect(result.length).toBe(10)
    expect(result[0].label).toBe("This session")
    expect(result[1].label).toBe("sub-20")
    expect(result[8].label).toBe("sub-13")

    const aggregated = result[9]
    expect(aggregated.label).toBe("12 older sessions")
    expect(aggregated.cost).toBeCloseTo(0.05 * 12)
  })

  it("collapses older nested rows after own-cost correction, not subtree totals", () => {
    const items = [
      { label: "This session", cost: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ label: "explore", cost: i + 2 })),
    ]
    const result = collapseCostBreakdown(items, summary)
    const hidden = result.at(-1)
    const shown = result.reduce((sum, item) => sum + item.cost, 0)

    expect(hidden).toEqual({ label: "2 older sessions", cost: 2 + 3 })
    expect(shown).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11)
  })
})

// ── Throughput aggregation ─────────────────────────────────────────────

function stepFinish(id: string, metrics?: NonNullable<Part["metrics"]>): Part {
  return {
    type: "step-finish",
    id,
    ...(metrics ? { metrics } : {}),
  }
}

describe("aggregateMetrics", () => {
  it("returns undefined when no step-finish parts carry metrics", () => {
    const parts: Part[] = [
      { type: "step-start", id: "s1" },
      stepFinish("f1"),
      { type: "text", id: "t1", text: "hello" },
    ]
    expect(aggregateMetrics(parts)).toBeUndefined()
  })

  it("merges the first non-empty metrics across every step in the session", () => {
    const parts: Part[] = [
      stepFinish("f1", { prompt: 100, generation: 20, source: "computed" }),
      { type: "text", id: "t1", text: "mid" },
      stepFinish("f2", { prompt: 412, generation: 38, source: "computed" }),
    ]
    expect(aggregateMetrics(parts)).toEqual({ prompt: 100, generation: 20, source: "computed" })
  })

  it("keeps the first computed sample for each field when later steps report zero", () => {
    const parts: Part[] = [
      stepFinish("f1", { prompt: 500, generation: 50, source: "computed" }),
      stepFinish("f2", { generation: 30, source: "computed" }),
    ]
    const result = aggregateMetrics(parts)
    expect(result?.source).toBe("computed")
    expect(result?.prompt).toBe(500)
    expect(result?.generation).toBe(50)
  })

  it("uses the first computed value per field when no earlier value is present", () => {
    const parts: Part[] = [
      stepFinish("f1", { generation: 12, source: "computed" }),
      stepFinish("f2", { generation: 18, source: "computed" }),
    ]
    expect(aggregateMetrics(parts)).toEqual({ generation: 12, source: "computed" })
  })

  it("ignores non-step-finish parts even when they look like metrics", () => {
    const parts: Part[] = [
      { type: "text", id: "t1", text: "noise" },
      stepFinish("f1", { prompt: 200, generation: 22, source: "computed" }),
    ]
    expect(aggregateMetrics(parts)).toEqual({ prompt: 200, generation: 22, source: "computed" })
  })

  it("combines multi-step metrics into a single snapshot per message", () => {
    // An assistant turn that runs reasoning + answer produces two step-finish
    // parts; the badge should merge them so a prompt sample from the first
    // step and a generation sample from the second coexist in the snapshot.
    const parts: Part[] = [
      stepFinish("f1", { prompt: 200, source: "computed" }),
      stepFinish("f2", { generation: 25, source: "computed" }),
    ]
    expect(messageMetrics(parts)).toEqual({ prompt: 200, generation: 25, source: "computed" })
  })
})

describe("messageMetrics", () => {
  it("matches aggregateMetrics behavior on the same input", () => {
    const parts: Part[] = [
      stepFinish("f1", { generation: 8, source: "computed" }),
      stepFinish("f2", { prompt: 99, generation: 33, source: "computed" }),
    ]
    expect(messageMetrics(parts)).toEqual(aggregateMetrics(parts))
  })

  it("returns undefined when no throughput metrics are present", () => {
    expect(messageMetrics([])).toBeUndefined()
    expect(messageMetrics([{ type: "text", id: "t1", text: "no metrics here" }])).toBeUndefined()
  })
})

describe("throughput formatters", () => {
  const locale = "en-US"

  it("renders the value with a t/s suffix", () => {
    expect(formatPP(412, locale)).toBe("412 t/s")
    expect(formatTG(28.7, locale)).toBe("28.7 t/s")
  })

  it("falls back to dash for missing or bogus values", () => {
    expect(formatPP(undefined, locale)).toBe("–")
    expect(formatPP(0, locale)).toBe("–")
    expect(formatPP(-5, locale)).toBe("–")
    expect(formatPP(Number.NaN, locale)).toBe("–")
    expect(formatPP(Number.POSITIVE_INFINITY, locale)).toBe("–")
    expect(formatTG(undefined, locale)).toBe("–")
  })
})
