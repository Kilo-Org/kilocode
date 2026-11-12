import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { childTools, createChildSessions } from "../webview-ui/src/v2/child-session"

const toolPart = (id: string) =>
  ({ type: "tool", id, name: "read", state: { status: "completed", input: {}, content: [] } }) as const

const assistant = (id: string, content: unknown[]) =>
  ({ id, type: "assistant", content }) as unknown as SessionMessageInfo

const user = { id: "user-1", type: "user", text: "hello" } as unknown as SessionMessageInfo

function data(options?: { root?: (id: string) => string; more?: () => boolean }) {
  const calls = { sync: [] as string[], loadMore: [] as string[], evict: [] as string[], invalidate: [] as string[] }
  return {
    calls,
    session: {
      message: {
        list: () => [user, assistant("a-1", [toolPart("t-1")])],
        sync: async (id: string) => {
          calls.sync.push(id)
        },
        invalidate: (id: string) => {
          calls.invalidate.push(id)
        },
        more: options?.more ?? (() => false),
        loadMore: async (id: string) => {
          calls.loadMore.push(id)
        },
        evict: (id: string) => {
          calls.evict.push(id)
        },
      },
      status: () => "idle",
      root: options?.root ?? ((id: string) => id.split("/")[0]!),
    },
  }
}

describe("childTools", () => {
  test("returns only tool parts from assistant messages, in order", () => {
    const messages = [
      user,
      assistant("a-1", [{ type: "reasoning", text: "thinking" }, toolPart("t-1")]),
      assistant("a-2", [toolPart("t-2")]),
    ]
    expect(childTools(messages).map((part) => part.id)).toEqual(["t-1", "t-2"])
  })

  test("returns an empty list for an unloaded child session", () => {
    expect(childTools([])).toEqual([])
  })
})

describe("createChildSessions", () => {
  test("pages a child history up to the page cap", async () => {
    let more = true
    const input = data({ more: () => more })
    const children = createChildSessions({ data: input, report: () => {}, pages: 2 })
    more = true
    await children.load("p/child")
    expect(input.calls.sync).toEqual(["p/child"])
    expect(input.calls.loadMore).toEqual(["p/child", "p/child"])
  })

  test("stops paging when the child has no more messages", async () => {
    let remaining = 1
    const input = data({
      more: () => remaining > 0,
    })
    input.session.message.loadMore = async (id: string) => {
      input.calls.loadMore.push(id)
      remaining--
    }
    const children = createChildSessions({ data: input, report: () => {}, pages: 4 })
    await children.load("p/child")
    expect(input.calls.loadMore).toEqual(["p/child"])
  })

  test("loads a child once and retries after a failure", async () => {
    let fail = false
    const errors: unknown[] = []
    const input = data()
    input.session.message.sync = async (id: string) => {
      input.calls.sync.push(id)
      if (fail) throw new Error("offline")
    }
    const children = createChildSessions({ data: input, report: (error) => errors.push(error) })
    await children.load("p/child")
    await children.load("p/child")
    expect(input.calls.sync).toEqual(["p/child"])
    fail = true
    await children.load("p/other")
    expect(errors).toHaveLength(1)
    fail = false
    await children.load("p/other")
    expect(input.calls.sync).toEqual(["p/child", "p/other", "p/other"])
  })

  test("loads a child again after its cached history is released", async () => {
    let present = true
    const input = data()
    input.session.message.list = () =>
      present ? [user, assistant("a-1", [toolPart("t-1")])] : []
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/child")
    expect(input.calls.sync).toEqual(["p/child"])
    // The inspector releases a subagent when its tab closes; the parent card keeps showing that child. The release
    // drops the cached messages and their sync marker, so the next request fetches them again.
    present = false
    await children.load("p/child")
    expect(input.calls.sync).toEqual(["p/child", "p/child"])
  })

  test("fetches an empty first read and does not invalidate it again", async () => {
    const input = data()
    input.session.message.list = () => []
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/child")
    await children.load("p/child")
    expect(input.calls.invalidate).toEqual(["p/child"])
  })

  test("re-syncs loaded children after a reconnect", async () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/child")
    await children.resync()
    expect(input.calls.sync).toEqual(["p/child", "p/child"])
  })

  test("keeps a child tree across parent, child, and sibling navigation", async () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/one")
    await children.load("p/two")
    children.switchTo("p", "p/one")
    children.switchTo("p/one", "p")
    children.switchTo("p/two", "p/one")
    expect(input.calls.evict).toEqual([])
    expect(children.loaded.size).toBe(2)
  })

  test("releases the viewed session when the root changes", async () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/one")
    children.switchTo("q", "p")
    expect(input.calls.evict).toEqual(["p", "p/one"])
    expect(children.loaded.size).toBe(0)
  })

  test("keeps a child view from releasing its parent transcript", () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    // The Agent Manager inspector shows a subagent in the same store as the parent chat. Closing or switching that
    // view must release the child, never the tree root the parent chat is still rendering.
    children.release("p/child")
    expect(input.calls.evict).toEqual(["p/child"])
    children.switchTo("q", "p/child")
    expect(input.calls.evict).toEqual(["p/child", "p/child"])
  })

  test("release evicts the viewed session and the children it loaded", async () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/one")
    children.release("p")
    expect(input.calls.evict).toEqual(["p", "p/one"])
    expect(children.loaded.size).toBe(0)
  })
})
