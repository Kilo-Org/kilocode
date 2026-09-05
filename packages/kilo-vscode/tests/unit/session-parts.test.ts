import { describe, expect, it } from "bun:test"
import { createStore, produce } from "solid-js/store"
import {
  isolate,
  mergeOptimisticPart,
  mergeOptimisticParts,
  mergeParts,
  sameParts,
} from "../../webview-ui/src/context/session-parts"
import type { Part } from "../../webview-ui/src/types/messages"

function text(id: string, value: string, time: { start?: number; end?: number } = {}): Part {
  return { id, messageID: "m1", type: "text", text: value, time: { start: time.start ?? 1, end: time.end } }
}

function tool(id: string): Part {
  return { id, messageID: "m1", type: "tool", tool: "bash", state: { status: "pending", input: {} } }
}

function file(id: string): Part {
  return { id, messageID: "m1", type: "file", mime: "text/plain", url: "data:,file" }
}

function value(parts: Part[], id: string) {
  const part = parts.find((item) => item.id === id)
  if (!part || part.type !== "text") return
  return part.text
}

describe("isolate", () => {
  it("keeps shared reasoning snapshots independent across session stores", () => {
    const shared = {
      id: "r1",
      messageID: "m1",
      type: "reasoning",
      text: "Thinking",
      time: { start: 1 },
    } satisfies Part
    const [first, setFirst] = createStore({ parts: [shared].map(isolate) })
    const [second, setSecond] = createStore({ parts: [shared].map(isolate) })

    setFirst(
      "parts",
      produce((parts) => {
        const part = parts[0]
        if (part?.type === "reasoning") part.text += " once"
      }),
    )
    setSecond(
      "parts",
      produce((parts) => {
        const part = parts[0]
        if (part?.type === "reasoning") part.text += " once"
      }),
    )

    expect(first.parts[0]?.type === "reasoning" && first.parts[0].text).toBe("Thinking once")
    expect(second.parts[0]?.type === "reasoning" && second.parts[0].text).toBe("Thinking once")
    expect(shared.text).toBe("Thinking")
  })
})

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

describe("mergeOptimisticPart", () => {
  it("replaces the optimistic user part when its canonical event arrives", () => {
    const current = [text("client", "queued prompt")]
    const result = mergeOptimisticPart(current, new Set(["client"]), text("server", "queued prompt"))

    expect(result.parts).toEqual([text("server", "queued prompt")])
    expect(result.replaced).toBe("client")
  })

  it("keeps unmatched optimistic parts while canonical attachments arrive", () => {
    const current = [text("client-text", "queued prompt"), file("client-file")]
    const result = mergeOptimisticPart(current, new Set(["client-text", "client-file"]), file("server-file"))

    expect(result.parts.map((part) => part.id)).toEqual(["client-text", "server-file"])
    expect(result.replaced).toBe("client-file")
  })

  it("keeps queued text when synthetic attachment context arrives first", () => {
    const current = [text("client-text", "queued prompt"), file("client-file")]
    const ids = new Set(current.map((part) => part.id))
    const part: Part = {
      id: "context",
      messageID: "m1",
      type: "text",
      text: "Attachment context",
      synthetic: true,
    }
    const context = mergeOptimisticPart(current, ids, part)

    expect(context.parts).toEqual([...current, part])
    expect(context.replaced).toBeUndefined()
    expect(value(context.parts, "client-text")).toBe("queued prompt")

    const body = { ...part, id: "contents", text: "Attachment contents" }
    const contents = mergeOptimisticPart(context.parts, ids, body)
    expect(contents.replaced).toBeUndefined()
    expect(value(contents.parts, "client-text")).toBe("queued prompt")

    const attachment = mergeOptimisticPart(contents.parts, ids, file("server-file"))
    expect(attachment.replaced).toBe("client-file")
    expect(value(attachment.parts, "client-text")).toBe("queued prompt")

    const result = mergeOptimisticPart(attachment.parts, ids, text("server-text", "queued prompt"))

    expect(result.parts).toEqual([text("server-text", "queued prompt"), file("server-file"), part, body])
    expect(result.replaced).toBe("client-text")
    expect(current).toEqual([text("client-text", "queued prompt"), file("client-file")])
  })

  it("preserves unresolved optimistic parts across partial snapshots", () => {
    const current = [text("client-text", "queued prompt"), file("client-file")]
    const ids = new Set(current.map((part) => part.id))
    const context: Part = {
      id: "context",
      messageID: "m1",
      type: "text",
      text: "Attachment context",
      synthetic: true,
    }

    const partial = mergeOptimisticParts(current, ids, [context])
    expect(partial.parts.map((part) => part.id)).toEqual(["client-text", "client-file", "context"])
    expect(partial.pending).toEqual(ids)
    const repeated = mergeOptimisticParts(partial.parts, partial.pending, [context])
    expect(repeated).toEqual(partial)

    const complete = mergeOptimisticParts(partial.parts, partial.pending, [text("server-text", "queued prompt")])
    expect(complete.parts.map((part) => part.id)).toEqual(["server-text", "client-file", "context"])
    expect(complete.pending).toEqual(new Set(["client-file"]))

    const resolved = mergeOptimisticParts(complete.parts, complete.pending, [
      text("server-text", "queued prompt"),
      file("server-file"),
    ])
    expect(resolved.parts.map((part) => part.id)).toEqual(["server-text", "server-file", "context"])
    expect(resolved.pending).toEqual(new Set())
  })

  it("retains confirmed text when a stale prefix resolves the last optimistic attachment", () => {
    const current = [text("server-text", "queued prompt"), file("client-file")]
    const result = mergeOptimisticParts(current, new Set(["client-file"]), [file("server-file")])

    expect(result.parts).toEqual([text("server-text", "queued prompt"), file("server-file")])
    expect(result.pending).toEqual(new Set())
  })

  it("uses a resolved snapshot as authoritative after optimism retires", () => {
    const current = [text("client-text", "queued prompt"), file("client-file")]
    const result = mergeOptimisticParts(current, new Set(), [text("server-text", "server prompt")])

    expect(result.parts).toEqual([text("server-text", "server prompt")])
    expect(result.pending).toEqual(new Set())
  })

  it("keeps streamed deltas independent across session stores", () => {
    const shared = text("server", "start")
    const [first, setFirst] = createStore({ parts: mergeOptimisticPart([], new Set(), shared).parts })
    const [second, setSecond] = createStore({ parts: mergeOptimisticPart([], new Set(), shared).parts })

    setFirst(
      "parts",
      produce((parts) => {
        const part = parts[0]
        if (part?.type === "text") part.text += " chunk"
      }),
    )
    setSecond(
      "parts",
      produce((parts) => {
        const part = parts[0]
        if (part?.type === "text") part.text += " chunk"
      }),
    )

    expect(value(first.parts, "server")).toBe("start chunk")
    expect(value(second.parts, "server")).toBe("start chunk")
    expect(value([shared], "server")).toBe("start")
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
