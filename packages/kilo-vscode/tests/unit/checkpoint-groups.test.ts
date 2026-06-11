import { describe, expect, it } from "bun:test"
import type { Part, StepFinishPart, StepStartPart, ToolPart } from "@kilocode/sdk/v2"
import {
  checkpointBoundary,
  checkpointLayout,
  checkpointPrompt,
  stableCheckpointLayout,
} from "../../webview-ui/src/components/chat/checkpoint-groups"

const sid = "session"
const mid = "message"

const base = (id: string) => ({ id, sessionID: sid, messageID: mid })
const start = (id: string, snapshot = `snapshot-${id}`): StepStartPart => ({
  ...base(id),
  type: "step-start",
  snapshot,
})
const finish = (id: string): StepFinishPart => ({
  ...base(id),
  type: "step-finish",
  reason: "tool-calls",
  snapshot: `snapshot-${id}`,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})
const tool = (id: string, name = "edit", callID = `call-${id}`): ToolPart => ({
  ...base(id),
  type: "tool",
  tool: name,
  callID,
  state: {
    status: "completed",
    input: {},
    output: "done",
    title: name,
    metadata: {},
    time: { start: 1, end: 2 },
  },
})
const text = (id: string): Part => ({ ...base(id), type: "text", text: id })
const patch = (id: string): Part => ({ ...base(id), type: "patch", hash: id, files: ["file.ts"] })

describe("checkpointLayout", () => {
  it("groups one tool-bearing step", () => {
    const layout = checkpointLayout([start("s1"), tool("t1"), finish("f1")])

    expect(layout.preamble).toEqual([])
    expect(layout.tail).toEqual([])
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]).toMatchObject({ active: false, parallel: false, turnStart: true })
    expect(layout.groups[0]?.tools.map((part) => part.id)).toEqual(["t1"])
  })

  it("keeps parallel tools in one checkpoint group", () => {
    const layout = checkpointLayout([start("s1"), tool("t1"), tool("t2"), finish("f1")])

    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]).toMatchObject({ active: false, parallel: true })
    expect(layout.groups[0]?.tools.map((part) => part.id)).toEqual(["t1", "t2"])
  })

  it("groups sequential steps independently", () => {
    const layout = checkpointLayout([
      start("s1"),
      tool("t1"),
      finish("f1"),
      patch("p1"),
      start("s2"),
      tool("t2"),
      finish("f2"),
      patch("p2"),
    ])

    expect(layout.groups).toHaveLength(2)
    expect(layout.groups.map((group) => group.start.id)).toEqual(["s1", "s2"])
    expect(layout.groups.map((group) => group.turnStart)).toEqual([true, false])
    expect(layout.tail.map((part) => part.id)).toEqual(["p1", "p2"])
  })

  it("preserves text around a tool without making structural parts renderable", () => {
    const layout = checkpointLayout([start("s1"), text("before"), tool("t1"), text("after"), finish("f1")])

    expect(layout.groups[0]?.parts.map((part) => part.id)).toEqual(["before", "t1", "after"])
  })

  it("marks an unfinished step active", () => {
    const layout = checkpointLayout([start("s1"), tool("t1")])

    expect(layout.groups[0]).toMatchObject({ active: true, parallel: false })
  })

  it("ignores text-only steps when selecting the first tool checkpoint", () => {
    const layout = checkpointLayout([start("s1"), text("answer"), finish("f1"), start("s2"), tool("t1"), finish("f2")])

    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[0]?.tools).toEqual([])
    expect(layout.groups[0]?.turnStart).toBe(false)
    expect(layout.groups[1]?.turnStart).toBe(true)
  })

  it("uses the user turn target for the first tool-bearing step despite preamble text", () => {
    const layout = checkpointLayout([text("preamble"), start("s1"), tool("t1"), finish("f1")])

    expect(layout.preamble.map((part) => part.id)).toEqual(["preamble"])
    expect(layout.groups[0]?.turnStart).toBe(true)
  })

  it("deduplicates repeated updates for one tool call", () => {
    const layout = checkpointLayout([
      start("s1"),
      tool("pending", "question", "same-call"),
      tool("complete", "question", "same-call"),
      finish("f1"),
    ])

    expect(layout.groups[0]?.tools.map((part) => part.id)).toEqual(["complete"])
    expect(layout.groups[0]?.parts.map((part) => part.id)).toEqual(["complete"])
    expect(layout.groups[0]?.parallel).toBe(false)
  })

  it.each(["question", "plan_exit"])("treats %s as a checkpoint tool", (name) => {
    const layout = checkpointLayout([start("s1"), tool("t1", name), finish("f1")])

    expect(layout.groups[0]?.tools[0]?.tool).toBe(name)
  })
})

describe("stableCheckpointLayout", () => {
  it("preserves a Question step group when reconciled parts keep their identity", () => {
    const parts = [start("s1"), tool("question", "question"), finish("f1")]
    const prev = checkpointLayout(parts)
    const next = stableCheckpointLayout(checkpointLayout([...parts]), prev)

    expect(next.groups[0]).toBe(prev.groups[0])
  })

  it("replaces a group when a tool update changes its part identity", () => {
    const prev = checkpointLayout([start("s1"), tool("pending", "question", "call"), finish("f1")])
    const next = stableCheckpointLayout(
      checkpointLayout([prev.groups[0]!.start, tool("completed", "question", "call"), prev.groups[0]!.finish!]),
      prev,
    )

    expect(next.groups[0]).not.toBe(prev.groups[0])
    expect(next.groups[0]?.tools[0]?.id).toBe("completed")
  })
})

describe("checkpointPrompt", () => {
  const parts: Part[] = [
    { ...base("text"), type: "text", text: "restore me" },
    { ...base("synthetic"), type: "text", text: "ignore me", synthetic: true },
  ]

  it("restores only real user prompt text for a message boundary", () => {
    expect(checkpointPrompt("user", parts)).toBe("restore me")
  })

  it("never copies assistant text for a part-level checkpoint", () => {
    expect(checkpointPrompt("assistant", parts, "part")).toBeUndefined()
    expect(checkpointPrompt("assistant", parts)).toBeUndefined()
    expect(checkpointPrompt("user", parts, "part")).toBeUndefined()
  })
})

describe("checkpointBoundary", () => {
  const parts = [start("s1"), tool("t1"), finish("f1"), start("s2"), tool("t2"), finish("f2")]

  it("keeps only parts before a selected step", () => {
    expect(checkpointBoundary(parts, "s2").map((part) => part.id)).toEqual(["s1", "t1", "f1"])
  })

  it("keeps all parts for an unknown or absent boundary", () => {
    expect(checkpointBoundary(parts)).toEqual(parts)
    expect(checkpointBoundary(parts, "missing")).toEqual(parts)
  })
})
