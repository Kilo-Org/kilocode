// kilocode_change - new file
import { describe, expect, test } from "bun:test"

async function load() {
  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  return import(`../../../src/kilocode/cli/cmd/tui/auto-approve?${key}`)
}

describe("tui auto-approve", () => {
  test("boot enables each startup session independently", async () => {
    const { TuiAutoApprove } = await load()

    expect(TuiAutoApprove.boot("ses_a")).toBe(true)
    expect(TuiAutoApprove.enabled("ses_a")).toBe(true)
    expect(TuiAutoApprove.boot("ses_b")).toBe(true)
    expect(TuiAutoApprove.enabled("ses_b")).toBe(true)
  })

  test("disabling clears last replied request", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
    TuiAutoApprove.mark("ses_a", "req_1")
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)

    TuiAutoApprove.set("ses_a", false)
    TuiAutoApprove.set("ses_a", true)

    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("reply tracking stays session scoped", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.set("ses_b", true)
    TuiAutoApprove.mark("ses_a", "req_1")

    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)
    expect(TuiAutoApprove.shouldReply("ses_b", "req_1")).toBe(true)
  })

  test("tracks multiple replied requests per session", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    expect(TuiAutoApprove.mark("ses_a", "req_1")).toBe(true)
    expect(TuiAutoApprove.mark("ses_a", "req_2")).toBe(true)

    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_2")).toBe(false)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_3")).toBe(true)
  })

  test("clear removes session state and replied requests", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.mark("ses_a", "req_1")
    TuiAutoApprove.clear("ses_a")

    expect(TuiAutoApprove.enabled("ses_a")).toBe(false)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)
    TuiAutoApprove.set("ses_a", true)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("prune clears sessions that are no longer active", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.set("ses_b", true)
    TuiAutoApprove.mark("ses_a", "req_1")
    TuiAutoApprove.prune(new Set(["ses_b"]))

    expect(TuiAutoApprove.enabled("ses_a")).toBe(false)
    expect(TuiAutoApprove.enabled("ses_b")).toBe(true)
    TuiAutoApprove.set("ses_a", true)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("unmark releases a single replied request without disabling the session", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.mark("ses_a", "req_1")
    TuiAutoApprove.unmark("ses_a", "req_1")

    expect(TuiAutoApprove.enabled("ses_a")).toBe(true)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("root resolves to the parent when present, otherwise the session id", async () => {
    const { TuiAutoApprove } = await load()

    expect(TuiAutoApprove.root({ id: "child", parentID: "root" })).toBe("root")
    expect(TuiAutoApprove.root({ id: "root", parentID: null })).toBe("root")
    expect(TuiAutoApprove.root({ id: "root" })).toBe("root")
    expect(TuiAutoApprove.root(undefined)).toBeUndefined()
  })

  test("scope returns the root plus direct parentID children only", async () => {
    const { TuiAutoApprove } = await load()

    const sessions = [
      { id: "root" },
      { id: "child1", parentID: "root" },
      { id: "child2", parentID: "root" },
      { id: "grandchild", parentID: "child1" },
      { id: "sibling", parentID: "other" },
    ]

    const scope = TuiAutoApprove.scope("root", sessions)

    expect([...scope].sort()).toEqual(["child1", "child2", "root"])
  })

  test("dropStale evicts replied ids that are no longer pending", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.mark("ses_a", "req_1")
    TuiAutoApprove.mark("ses_a", "req_2")
    TuiAutoApprove.mark("ses_b", "req_3")
    TuiAutoApprove.dropStale([{ id: "req_2" }, { id: "req_3" }])

    // req_1 is no longer pending, so a new reply for it should fire
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
    // req_2 is still pending, dedupe still applies
    expect(TuiAutoApprove.shouldReply("ses_a", "req_2")).toBe(false)
    // req_3 is still pending, dedupe still applies on ses_b
    expect(TuiAutoApprove.shouldReply("ses_b", "req_3")).toBe(false)
  })

  test("roots lists every enabled session", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.set("ses_b", true)

    expect(new Set(TuiAutoApprove.roots())).toEqual(new Set(["ses_a", "ses_b"]))
  })
})
