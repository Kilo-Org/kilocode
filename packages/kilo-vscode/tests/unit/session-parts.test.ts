import { describe, expect, it } from "bun:test"
import { mergeParts, sameParts } from "../../webview-ui/src/context/session-parts"
import type { Part } from "../../webview-ui/src/types/messages"

function text(id: string, value: string, time: { start?: number; end?: number } = {}): Part {
  return { id, messageID: "m1", type: "text", text: value, time: { start: time.start ?? 1, end: time.end } }
}

function tool(id: string): Part {
  return { id, messageID: "m1", type: "tool", tool: "bash", state: { status: "pending", input: {} } }
}

function value(parts: Part[], id: string) {
  const part = parts.find((item) => item.id === id)
  if (!part || part.type !== "text") return
  return part.text
}

describe("mergeParts", () => {
  it("keeps a final streamed tail part created after the reconcile snapshot started", () => {
    const parts = mergeParts(
      [text("p1", "tool done", { end: 2 }), text("p2", "final summary", { start: 20, end: 30 })],
      [text("p1", "tool done", { end: 2 })],
      10,
    )

    expect(parts.map((part) => part.id)).toEqual(["p1", "p2"])
    expect(value(parts, "p2")).toBe("final summary")
  })

  it("drops trailing local text that predates the reconcile snapshot", () => {
    const parts = mergeParts(
      [text("p1", "tool done", { end: 2 }), text("p2", "stale tail", { start: 5 })],
      [text("p1", "tool done", { end: 2 })],
      10,
    )

    expect(parts.map((part) => part.id)).toEqual(["p1"])
  })

  it("drops local-only parts that do not prove they were appended after the snapshot", () => {
    const parts = mergeParts(
      [text("p1", "stale", { start: 20 }), text("p3", "live tail", { start: 20 })],
      [text("p2", "server")],
      10,
    )

    expect(parts.map((part) => part.id)).toEqual(["p2", "p3"])
  })

  it("drops local-only non-stream parts so reconcile can heal removals", () => {
    const parts = mergeParts([text("p1", "server", { end: 2 }), tool("p2")], [text("p1", "server", { end: 2 })], 10)

    expect(parts.map((part) => part.id)).toEqual(["p1"])
  })

  it("drops local streamed parts when the snapshot has no part boundary", () => {
    const parts = mergeParts([text("p1", "stale streamed text", { start: 20 })], [], 10)

    expect(parts).toEqual([])
  })

  it("keeps longer streaming text when an open snapshot has an older prefix", () => {
    const parts = mergeParts([text("p1", "Recommendation: approve with notes")], [text("p1", "Recommendation")], 10)

    expect(value(parts, "p1")).toBe("Recommendation: approve with notes")
  })

  it("uses completed snapshot text even when local text is a longer prefix extension", () => {
    const parts = mergeParts(
      [text("p1", "Recommendation: approve with notes")],
      [text("p1", "Recommendation", { end: 2 })],
      10,
    )

    expect(value(parts, "p1")).toBe("Recommendation")
  })

  it("uses snapshots for mismatched types, non-prefix text, and shorter local text", () => {
    const types = mergeParts([tool("p1")], [text("p1", "server")], 10)
    const edited = mergeParts([text("p1", "local rewrite")], [text("p1", "server")], 10)
    const longer = mergeParts([text("p1", "short")], [text("p1", "longer server")], 10)

    expect(value(types, "p1")).toBe("server")
    expect(value(edited, "p1")).toBe("server")
    expect(value(longer, "p1")).toBe("longer server")
  })

  it("uses snapshot repairs while preserving proven streamed tail parts in ID order", () => {
    const parts = mergeParts(
      [text("p3", "live tail", { start: 20 }), text("p1", "partial")],
      [text("p2", "missed snapshot part"), text("p1", "complete snapshot repair", { end: 2 })],
      10,
    )

    expect(parts.map((part) => part.id)).toEqual(["p1", "p2", "p3"])
    expect(value(parts, "p1")).toBe("complete snapshot repair")
    expect(value(parts, "p2")).toBe("missed snapshot part")
    expect(value(parts, "p3")).toBe("live tail")
  })
})

describe("sameParts", () => {
  it("accepts equal hydrated and snapshot parts", () => {
    expect(sameParts([text("p1", "done", { end: 2 })], [text("p1", "done", { end: 2 })])).toBe(true)
  })

  it("rejects same-count snapshots with different ids, text, or completion state", () => {
    expect(sameParts([text("p1", "done", { end: 2 })], [text("p2", "done", { end: 2 })])).toBe(false)
    expect(sameParts([text("p1", "live")], [text("p1", "server")])).toBe(false)
    expect(sameParts([text("p1", "done")], [text("p1", "done", { end: 2 })])).toBe(false)
  })
})
