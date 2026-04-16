import { describe, it, expect } from "bun:test"
import {
  SessionStreamScheduler,
  type PartBatch,
  type PartUpdate,
} from "../../src/kilo-provider/session-stream-scheduler"

type Item = PartUpdate
type Sent = PartUpdate | PartBatch

function update(text: string, delta?: string, sid = "sess-1", partID = "p1") {
  const msg: Item = {
    type: "partUpdated",
    sessionID: sid,
    messageID: "m1",
    part: { id: partID, type: "text", messageID: "m1", text },
  }
  if (delta === undefined) return msg
  return { ...msg, delta: { type: "text-delta", textDelta: delta } } as Item
}

function items(sent: Sent[]): Item[] {
  return sent.flatMap((msg) => (msg.type === "partsUpdated" ? msg.updates : [msg]))
}

function flushSync(...msgs: Item[]): Sent[] {
  const sent: Sent[] = []
  const queue = new SessionStreamScheduler((msg) => sent.push(msg))
  for (const msg of msgs) queue.push(msg)
  queue.flush()
  return sent
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function partText(msg: Item): string {
  return (msg.part as { text: string }).text
}

describe("SessionStreamScheduler / coalescing", () => {
  it("merges repeated text deltas", () => {
    const sent = items(flushSync(update("a", "a"), update("b", "b")))
    expect(sent).toHaveLength(1)
    expect(partText(sent[0]!)).toBe("ab")
    expect(sent[0]!.delta?.textDelta).toBe("ab")
  })

  it("uses part messageID when messageID is blank", () => {
    const sent = items(flushSync({ ...update("a", "a"), messageID: "" }, { ...update("b", "b"), messageID: "" }))
    expect(sent).toHaveLength(1)
    expect(partText(sent[0]!)).toBe("ab")
  })

  it("appends deltas onto queued full parts", () => {
    const sent = items(flushSync(update("hello"), update(" world", " world")))
    expect(partText(sent[0]!)).toBe("hello world")
    expect(sent[0]!.delta).toBeUndefined()
  })

  it("keeps the latest full part", () => {
    const sent = items(flushSync(update("old"), update("new")))
    expect(partText(sent[0]!)).toBe("new")
  })

  it("flushes deltas before later full updates", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push(update("a", "a"))
    queue.push(update("done"))
    queue.flush()
    const flat = items(sent)
    expect(flat).toHaveLength(2)
    expect(partText(flat[0]!)).toBe("a")
    expect(partText(flat[1]!)).toBe("done")
  })

  it("emits non-keyable updates immediately and flushes pending first", () => {
    // A part without an id can't be coalesced. We must flush any queued deltas
    // for the same session first to preserve ordering, then emit directly.
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push(update("queued", "queued"))
    queue.push({
      type: "partUpdated",
      sessionID: "sess-1",
      messageID: "m1",
      part: { type: "text", messageID: "m1", text: "noId" },
    })
    queue.flush()
    const flat = items(sent)
    expect(flat).toHaveLength(2)
    expect(partText(flat[0]!)).toBe("queued")
    expect(partText(flat[1]!)).toBe("noId")
  })
})

describe("SessionStreamScheduler / session isolation", () => {
  it("batches multiple sessions into one partsUpdated message", () => {
    const sent = flushSync(update("a", "a", "sess-1"), update("b", "b", "sess-2"))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.type).toBe("partsUpdated")
    expect(items(sent)).toHaveLength(2)
  })

  it("never merges across sessions, messages, or parts", () => {
    // Identity invariants: provider caching and session isolation depend on
    // sessionID / messageID / partID never being swapped or combined.
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push({
      ...update("a", "a", "sess-1"),
      messageID: "m1",
      part: { id: "p1", type: "text", messageID: "m1", text: "a" },
    })
    queue.push({
      ...update("b", "b", "sess-2"),
      messageID: "m1",
      part: { id: "p1", type: "text", messageID: "m1", text: "b" },
    })
    queue.push({
      ...update("c", "c", "sess-1"),
      messageID: "m2",
      part: { id: "p1", type: "text", messageID: "m2", text: "c" },
    })
    queue.push({
      ...update("d", "d", "sess-1"),
      messageID: "m1",
      part: { id: "p2", type: "text", messageID: "m1", text: "d" },
    })
    queue.flush()
    const flat = items(sent)
    expect(flat).toHaveLength(4)
    const keys = flat.map((msg) => `${msg.sessionID}:${msg.messageID}:${(msg.part as { id: string }).id}`)
    expect(new Set(keys).size).toBe(4)
    expect(keys).toEqual(expect.arrayContaining(["sess-1:m1:p1", "sess-2:m1:p1", "sess-1:m2:p1", "sess-1:m1:p2"]))
  })

  it("preserves all part fields and concatenates deltas in arrival order", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push({
      type: "partUpdated",
      sessionID: "sess-1",
      messageID: "m1",
      part: { id: "p1", type: "text", messageID: "m1", text: "hi", extraMetadata: { tokens: 42 } },
    })
    queue.push({
      type: "partUpdated",
      sessionID: "sess-1",
      messageID: "m1",
      part: { id: "p1", type: "text", messageID: "m1", text: "hi world" },
      delta: { type: "text-delta", textDelta: " world" },
    })
    queue.push({
      type: "partUpdated",
      sessionID: "sess-1",
      messageID: "m1",
      part: { id: "p1", type: "text", messageID: "m1", text: "hi world!" },
      delta: { type: "text-delta", textDelta: "!" },
    })
    queue.flush()
    const flat = items(sent)
    expect(flat).toHaveLength(1)
    const part = flat[0]!.part as { text: string; extraMetadata?: { tokens: number } }
    expect(part.extraMetadata?.tokens).toBe(42)
    expect(part.text).toBe("hi world!")
    // When deltas fold into a queued full part, emit as a full-part replacement
    // so the webview does an authoritative replace rather than appending.
    expect(flat[0]!.delta).toBeUndefined()
  })
})

describe("SessionStreamScheduler / focus and lifecycle", () => {
  it("flushes a newly focused session immediately", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push(update("a", "a", "sess-2"))
    queue.focus("sess-2")
    expect(partText(items(sent)[0]!)).toBe("a")
  })

  it("drop() discards queued updates for the session", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-2"))
    queue.drop("sess-2")
    queue.drop("sess-1")
    queue.flush()
    expect(sent).toHaveLength(0)
  })

  it("drop() before an authoritative snapshot prevents queued delta duplication", async () => {
    // Race: a text-delta is queued while the caller is fetching a messages
    // snapshot. If the snapshot already reflects the delta (server-authoritative),
    // emitting the queued delta after messagesLoaded would duplicate streamed text
    // in the webview. drop() must prevent any further emission of queued work.
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 5,
      backgroundStepMs: 0,
      backgroundMaxMs: 5,
    })
    queue.focus("sess-1")
    queue.push(update("hello", "hello", "sess-1"))
    queue.push(update(" world", " world", "sess-1"))
    // Snapshot arrives; caller discards queued deltas before posting messagesLoaded.
    queue.drop("sess-1")
    await sleep(25)
    // No queued updates should leak out after the drop.
    expect(sent).toHaveLength(0)
    queue.dispose()
  })

  it("drop() on the active session keeps focus intact", async () => {
    // drop() is used when an authoritative snapshot supersedes buffered deltas
    // (e.g. messagesLoaded after a fetch). We just focused this session for the
    // user and need the NEXT pushes to keep using the low-latency active lane.
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 500,
      backgroundStepMs: 0,
      backgroundMaxMs: 500,
    })
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.drop("sess-1")
    // Pending delta discarded; snapshot would now be posted by the caller.
    // A subsequent push for the same session still lands on the active lane.
    queue.push(update("b", "b", "sess-1"))
    await sleep(25)
    const flat = items(sent)
    expect(flat).toHaveLength(1)
    expect(partText(flat[0]!)).toBe("b")
    expect(queue.stats().active).toBe(1)
    expect(queue.stats().background).toBe(0)
    queue.dispose()
  })

  it("focus(undefined) clears the active session", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.focus("sess-1")
    queue.focus(undefined)
    queue.push(update("a", "a", "sess-1"))
    queue.flush()
    // With no active session, the update lands on the background path but flush
    // drains everything synchronously.
    const stats = queue.stats()
    expect(stats.background).toBe(1)
    expect(stats.active).toBe(0)
  })

  it("dispose() stops further emissions from queued work", async () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 5,
      backgroundStepMs: 0,
      backgroundMaxMs: 5,
    })
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("b", "b", "sess-2"))
    queue.dispose()
    await sleep(25)
    expect(sent).toHaveLength(0)
  })

  it("flush() with no argument drains everything across sessions", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("b", "b", "sess-2"))
    queue.push(update("c", "c", "sess-3"))
    queue.flush()
    expect(items(sent)).toHaveLength(3)
  })

  it("flush(sid) on an empty session is a no-op", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.flush("sess-does-not-exist")
    expect(sent).toHaveLength(0)
  })
})

describe("SessionStreamScheduler / adaptive scheduling", () => {
  it("active session flushes on its cadence", async () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 1000,
      backgroundStepMs: 0,
      backgroundMaxMs: 1000,
    })
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("b", "b", "sess-1"))
    await sleep(25)
    expect(partText(items(sent)[0]!)).toBe("ab")
    expect(queue.stats().active).toBe(1)
    expect(queue.stats().background).toBe(0)
    queue.dispose()
  })

  it("background lane throttles independently of active", async () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 20,
      backgroundStepMs: 0,
      backgroundMaxMs: 20,
    })
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("x", "x", "sess-2"))
    queue.push(update("y", "y", "sess-3"))
    await sleep(15)
    expect(sent).toHaveLength(1)
    await sleep(25)
    expect(sent).toHaveLength(2)
    expect(queue.stats().active).toBe(1)
    expect(queue.stats().background).toBe(1)
    queue.dispose()
  })

  it("focus(A→B) flushes B immediately and schedules A on background", async () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 50,
      backgroundBaseMs: 10,
      backgroundStepMs: 0,
      backgroundMaxMs: 10,
    })
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("b", "b", "sess-2"))
    queue.focus("sess-2")
    expect(items(sent).some((msg) => partText(msg) === "b")).toBe(true)
    await sleep(25)
    expect(items(sent).some((msg) => partText(msg) === "a")).toBe(true)
    queue.dispose()
  })

  it("adaptive backoff lengthens background interval with many sessions", async () => {
    // Base 10ms + 20ms per extra background session beyond 2, capped at 200ms.
    // 10 background sessions → 10 + 8 * 20 = 170ms.
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 10,
      backgroundStepMs: 20,
      backgroundMaxMs: 200,
    })
    for (let i = 1; i <= 10; i++) queue.push(update(`t${i}`, `t${i}`, `sess-${i}`))
    await sleep(60)
    // With 10 bg sessions, interval is 170ms — nothing should have flushed at 60ms.
    expect(sent).toHaveLength(0)
    await sleep(180)
    // One batch emitted for all 10 sessions.
    expect(sent).toHaveLength(1)
    expect(items(sent)).toHaveLength(10)
    queue.dispose()
  })

  it("backoff is capped at backgroundMaxMs", async () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg), {
      activeMs: 5,
      backgroundBaseMs: 10,
      backgroundStepMs: 100,
      backgroundMaxMs: 50,
    })
    // Without the cap, 5 bg sessions would schedule 10 + 3*100 = 310ms.
    // Cap forces it to 50ms.
    for (let i = 1; i <= 5; i++) queue.push(update(`t${i}`, `t${i}`, `sess-${i}`))
    await sleep(80)
    expect(sent).toHaveLength(1)
    queue.dispose()
  })
})

describe("SessionStreamScheduler / stats", () => {
  it("tracks received / emitted / batches / lane counters", () => {
    const sent: Sent[] = []
    const queue = new SessionStreamScheduler((msg) => sent.push(msg))
    queue.focus("sess-1")
    queue.push(update("a", "a", "sess-1"))
    queue.push(update("b", "b", "sess-1"))
    queue.push(update("x", "x", "sess-2"))
    queue.flush()
    const stats = queue.stats()
    expect(stats.received).toBe(3)
    // Two deltas merged in sess-1, one update in sess-2 → 2 unique updates emitted.
    expect(stats.emitted).toBe(2)
    // Single flush produces one batch message.
    expect(stats.batches).toBe(1)
    // Lane counters are incremented once per emission (batch or single).
    expect(stats.active + stats.background).toBe(stats.batches)
  })
})
