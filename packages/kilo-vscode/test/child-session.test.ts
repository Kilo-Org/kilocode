import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { childTools, createChildSessions } from "../webview-ui/src/v2/child-session"

const toolPart = (id: string) =>
  ({ type: "tool", id, name: "read", state: { status: "completed", input: {}, content: [] } }) as const

const assistant = (id: string, content: unknown[]) =>
  ({ id, type: "assistant", content }) as unknown as SessionMessageInfo

const user = { id: "user-1", type: "user", text: "hello" } as unknown as SessionMessageInfo

function data(options?: { root?: (id: string) => string; more?: () => boolean }) {
  const calls = { sync: [] as string[], loadMore: [] as string[], evict: [] as string[] }
  return {
    calls,
    session: {
      message: {
        list: () => [user, assistant("a-1", [toolPart("t-1")])],
        sync: async (id: string) => {
          calls.sync.push(id)
        },
        more: options?.more ?? (() => false),
        loadMore: async (id: string) => {
          calls.loadMore.push(id)
        },
      },
      status: () => "idle",
      root: options?.root ?? ((id: string) => id.split("/")[0]!),
      evict: (id: string) => {
        calls.evict.push(id)
      },
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

  test("releases a child tree when the root changes or the session closes", async () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    await children.load("p/one")
    children.switchTo("p/one", "q")
    expect(input.calls.evict).toEqual(["q"])
    expect(children.loaded.size).toBe(0)
    await children.load("p/one")
    children.switchTo("other", "p/one")
    expect(input.calls.evict).toEqual(["q", "p"])
    await children.load("p/one")
    children.switchTo(undefined, "p")
    expect(input.calls.evict).toEqual(["q", "p", "p"])
    expect(children.loaded.size).toBe(0)
  })

  test("evicts the previous root when no child was loaded", () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    children.switchTo("q", "p")
    expect(input.calls.evict).toEqual(["p"])
    children.switchTo(undefined, "q")
    expect(input.calls.evict).toEqual(["p", "q"])
  })

  test("release evicts the open session when no child was loaded", () => {
    const input = data()
    const children = createChildSessions({ data: input, report: () => {} })
    children.release("p")
    expect(input.calls.evict).toEqual(["p"])
  })
})
