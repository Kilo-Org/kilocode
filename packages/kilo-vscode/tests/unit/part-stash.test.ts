import { describe, it, expect } from "bun:test"
import { PartStash } from "../../webview-ui/src/context/part-stash"
import type { Part } from "../../webview-ui/src/types/messages"

function text(id: string, messageID: string, value: string): Part {
  return { type: "text", id, messageID, text: value } as Part
}

describe("PartStash", () => {
  it("put / peek round-trips parts", () => {
    const stash = new PartStash()
    stash.put("m1", [text("p1", "m1", "hi")])
    const peeked = stash.peek("m1")
    expect(peeked?.[0] && "text" in peeked[0] ? peeked[0].text : undefined).toBe("hi")
  })

  it("remove() clears stashed parts — regression for handleMessageRemoved leak", () => {
    // Before the fix, handleMessageRemoved wiped reactive parts but left the
    // stash entry alive. If an off-screen message was removed before its turn
    // mounted, its parts would sit in the stash forever. Worse: a later call
    // to peek() or getParts() could surface the parts of a deleted message.
    const stash = new PartStash()
    stash.put("m1", [text("p1", "m1", "stale")])
    stash.remove("m1")
    expect(stash.peek("m1")).toBeUndefined()
    expect(stash.size()).toBe(0)
  })

  it("take() consumes stashed parts atomically", () => {
    const stash = new PartStash()
    stash.put("m1", [text("p1", "m1", "a")])
    stash.put("m2", [text("p2", "m2", "b")])
    const taken = stash.take(["m1", "m2"])
    expect(Object.keys(taken).sort()).toEqual(["m1", "m2"])
    expect(stash.size()).toBe(0)
  })

  it("take() skips IDs already hydrated into the reactive store", () => {
    const stash = new PartStash()
    stash.put("m1", [text("p1", "m1", "stash")])
    const taken = stash.take(["m1"], (id) => id === "m1")
    expect(taken).toEqual({})
    // The stash entry should be preserved — hydrateParts will noop and
    // subsequent SSE updates that target the message can still merge into it
    // if needed.
    expect(stash.peek("m1")).toBeDefined()
  })

  it("take() returns empty when no IDs match", () => {
    const stash = new PartStash()
    stash.put("m1", [text("p1", "m1", "a")])
    expect(stash.take(["m2", "m3"])).toEqual({})
  })
})
