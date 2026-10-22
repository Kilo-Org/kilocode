import { describe, test, expect } from "bun:test"
import { Inbox } from "@/kilocode/session-export/worker/inbox"

describe("Inbox", () => {
  test("tracks byte size and reports overflow once per session", () => {
    const inbox = new Inbox({ capacityBytes: 1000 })
    inbox.enqueue("s1", new Array(400).fill(0).join(""), { type: "x" } as never)
    expect(inbox.usedBytes()).toBeGreaterThan(0)
    inbox.enqueue("s1", new Array(500).fill(0).join(""), { type: "x" } as never)

    const dropped = inbox.enqueue("s1", new Array(800).fill(0).join(""), { type: "x" } as never)
    expect(dropped).toEqual({ accepted: false, sessionFirstOverflow: true })

    const again = inbox.enqueue("s1", new Array(800).fill(0).join(""), { type: "x" } as never)
    expect(again).toEqual({ accepted: false, sessionFirstOverflow: false })
  })

  test("drain returns items in FIFO order and frees capacity", () => {
    const inbox = new Inbox({ capacityBytes: 10_000 })
    inbox.enqueue("s1", "abc", { type: "a" } as never)
    inbox.enqueue("s1", "defg", { type: "b" } as never)
    const drained = inbox.drainBatch(1)
    expect(drained.length).toBe(1)
    expect((drained[0].envelope as { type: string }).type).toBe("a")
    expect(inbox.usedBytes()).toBe(4)
  })
})
