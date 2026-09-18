import { describe, it, expect } from "bun:test"
import { fetchMessagePage } from "../../src/kilo-provider/message-page"

type Message = {
  info: { id: string; role: "user" | "assistant"; parentID?: string; summary?: boolean; time: { created: number } }
  parts: unknown[]
}

function message(id: string, role: "user" | "assistant", time: number, parentID?: string): Message {
  return { info: { id, role, parentID, time: { created: time } }, parts: [] }
}

function mockClient(pages: { items: Message[]; cursor?: string }[]) {
  const calls: { before?: string; limit?: number }[] = []
  let idx = 0
  const client = {
    session: {
      messages: async (
        params: { sessionID: string; directory: string; limit: number; before?: string },
        _opts: { throwOnError: boolean; signal?: AbortSignal },
      ) => {
        calls.push({ before: params.before, limit: params.limit })
        const page = pages[idx++]
        if (!page) throw new Error("no more mock pages")
        const headers = new Headers()
        if (page.cursor) headers.set("X-Next-Cursor", page.cursor)
        return {
          data: page.items,
          response: { headers } as Response,
        }
      },
    },
  }
  return { client, calls }
}

describe("fetchMessagePage / cursor fallback", () => {
  it("shows only the latest complete turn and keeps every earlier turn pageable", async () => {
    const items = [
      message("m1", "user", 10),
      message("m2", "assistant", 20, "m1"),
      message("m3", "user", 30),
      message("m4", "assistant", 40, "m3"),
      message("m5", "user", 50),
    ]
    const calls: string[] = []
    const client = {
      session: {
        messages: async (params: { before?: string }) => {
          const cursor = params.before ? JSON.parse(Buffer.from(params.before, "base64url").toString()) : undefined
          calls.push(cursor?.id ?? "tail")
          return {
            data: items.filter((item) => !cursor || item.info.time.created < cursor.time),
            response: new Response(),
          }
        },
      },
    }
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 80,
      tail: true,
    })
    expect(page.items.map((item) => item.info.id)).toEqual(["m3", "m4", "m5"])
    const older = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 80,
      before: page.cursor,
    })
    expect([...older.items, ...page.items]).toEqual(items)
    expect(calls).toEqual(["tail", "m3"])
  })

  it("returns complete recent turns without waiting for older pages on a cold load", async () => {
    const { client, calls } = mockClient([
      {
        items: [message("m2", "assistant", 30, "m1"), message("m3", "user", 30), message("m4", "assistant", 30, "m3")],
        cursor: "c1",
      },
      { items: [message("m1", "user", 10), message("m2", "assistant", 30, "m1")] },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
      tail: true,
    })

    expect(calls).toHaveLength(1)
    expect(page.items.map((item) => item.info.id)).toEqual(["m3", "m4"])
    expect(JSON.parse(Buffer.from(page.cursor!, "base64url").toString())).toEqual({ id: "m3", time: 30 })

    const older = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
      before: page.cursor,
    })
    expect([...older.items, ...page.items].map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4"])
    expect(calls.at(1)?.before).toBe(page.cursor)
  })

  it("does not trim replies interleaved with queued prompts whose parent is missing", async () => {
    const { client, calls } = mockClient([
      {
        items: [message("m2", "assistant", 20, "m1"), message("m3", "user", 30), message("m4", "assistant", 40, "m1")],
        cursor: "c1",
      },
      { items: [message("m1", "user", 10)] },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
      tail: true,
    })
    expect(calls).toHaveLength(2)
    expect(page.items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4"])
  })

  it("retains a compaction summary together with its compaction parent", async () => {
    const parent = message("m3", "user", 30)
    parent.parts = [{ type: "compaction", auto: true }]
    const summary = message("m4", "assistant", 40, "m3")
    summary.info.summary = true
    const { client, calls } = mockClient([
      { items: [message("m2", "assistant", 20, "m1"), parent, summary], cursor: "c1" },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
      tail: true,
    })
    expect(calls).toHaveLength(1)
    expect(page.items).toEqual([parent, summary])
  })

  it("still fills a cold page containing only a partial turn and queued prompts", async () => {
    const { client, calls } = mockClient([
      { items: [message("m2", "assistant", 20), message("m3", "user", 30)], cursor: "c1" },
      { items: [message("m1", "user", 10)] },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 2,
      tail: true,
    })
    expect(calls).toHaveLength(2)
    expect(page.items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3"])
    expect(page.cursor).toBeUndefined()
  })

  it("does not trim full-history exports even when tail is requested", async () => {
    const items = [message("m1", "assistant", 10), message("m2", "user", 20), message("m3", "assistant", 30)]
    const { client } = mockClient([{ items }])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 0,
      tail: true,
    })
    expect(page.items).toEqual(items)
    expect(page.cursor).toBeUndefined()
  })

  it("returns server cursor when X-Next-Cursor header is present", async () => {
    const { client } = mockClient([
      {
        items: [message("m1", "user", 1), message("m2", "assistant", 2), message("m3", "user", 3)],
        cursor: "server-cursor-abc",
      },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
    })
    expect(page.cursor).toBe("server-cursor-abc")
  })

  it("synthesizes a cursor when server omits X-Next-Cursor but page is full (header stripped by proxy / missing permission)", async () => {
    // Regression: if a proxy or auth layer strips X-Next-Cursor, the webview
    // loses access to older messages even when they exist. When the response
    // fills the requested limit, derive a cursor from the oldest item so the
    // "load earlier" path keeps working.
    const { client } = mockClient([
      {
        items: [
          message("m1", "user", 10),
          message("m2", "assistant", 20),
          message("m3", "user", 30),
          message("m4", "assistant", 40),
        ],
        // Intentionally no cursor — simulating a stripped header.
      },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 4,
    })
    expect(page.cursor).toBeDefined()
    // Cursor must be a base64url-encoded { id, time } of the oldest item so
    // the server's before parser accepts it on the next request.
    const decoded = JSON.parse(Buffer.from(page.cursor!, "base64url").toString("utf8"))
    expect(decoded).toEqual({ id: "m1", time: 10 })
  })

  it("leaves cursor undefined when server omits header AND page is not full (truly no more)", async () => {
    const { client } = mockClient([
      {
        items: [message("m1", "user", 10), message("m2", "assistant", 20)],
      },
    ])
    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 80,
    })
    expect(page.cursor).toBeUndefined()
  })

  it("synthesized cursor round-trips through the server's before parameter", async () => {
    // First page: server strips header, items fill limit -> cursor synthesized.
    // Next page request uses that cursor and returns more items.
    const { client, calls } = mockClient([
      {
        items: [message("m3", "user", 30), message("m4", "assistant", 40)],
      },
      {
        items: [message("m1", "user", 10), message("m2", "assistant", 20)],
      },
    ])
    const first = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 2,
    })
    expect(first.cursor).toBeDefined()

    await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 2,
      before: first.cursor,
    })
    expect(calls[1]?.before).toBe(first.cursor)
  })

  it("keeps all fetched older messages when filling a partial assistant turn", async () => {
    const { client, calls } = mockClient([
      {
        items: [message("m4", "assistant", 40), message("m5", "user", 50)],
        cursor: "c1",
      },
      {
        items: [message("m1", "user", 10), message("m2", "assistant", 20), message("m3", "user", 30)],
        cursor: "c2",
      },
    ])

    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 3,
    })

    expect(calls.map((call) => call.before)).toEqual([undefined, "c1"])
    expect(page.items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4", "m5"])
    expect(page.cursor).toBe("c2")
  })

  it("continues fetching until a partial assistant turn reaches the first user message", async () => {
    const { client, calls } = mockClient([
      {
        items: [message("m4", "assistant", 40), message("m5", "user", 50)],
        cursor: "c1",
      },
      {
        items: [message("m2", "assistant", 20), message("m3", "user", 30)],
        cursor: "c2",
      },
      {
        items: [message("m1", "user", 10)],
      },
    ])

    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 2,
    })

    expect(calls.map((call) => call.before)).toEqual([undefined, "c1", "c2"])
    expect(page.items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4", "m5"])
    expect(page.cursor).toBeUndefined()
  })

  it("bounds assistant turn filling when older pages never reach a user message", async () => {
    const { client, calls } = mockClient([
      {
        items: [message("m5", "assistant", 50), message("m6", "assistant", 60)],
        cursor: "c1",
      },
      {
        items: [message("m3", "assistant", 30), message("m4", "assistant", 40)],
        cursor: "c2",
      },
      {
        items: [message("m1", "assistant", 10), message("m2", "assistant", 20)],
        cursor: "c3",
      },
      {
        items: [message("m0", "user", 0)],
      },
    ])

    const page = await fetchMessagePage(client as never, {
      sessionID: "s1",
      workspaceDir: "/repo",
      limit: 2,
    })

    expect(calls.map((call) => call.before)).toEqual([undefined, "c1", "c2"])
    expect(page.items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
    expect(page.cursor).toBe("c3")
  })
})
