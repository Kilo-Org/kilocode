import { describe, expect, it } from "bun:test"
import { fetchSessionPage, mergeSessions, SESSION_PAGE_LIMIT } from "../../src/kilo-provider/session-page"

type Item = { id: string; time: { updated: number } }

function client(data: Item[], header?: string) {
  const calls: Array<Record<string, unknown>> = []
  const headers = new Headers()
  if (header !== undefined) headers.set("x-next-cursor", header)
  return {
    calls,
    experimental: {
      session: {
        list: async (query: Record<string, unknown>) => {
          calls.push(query)
          return { data, response: { headers } }
        },
      },
    },
  }
}

describe("fetchSessionPage", () => {
  it("requests one page for the directory and returns the header cursor", async () => {
    const api = client([{ id: "ses_1", time: { updated: 10 } }], "7")
    const page = await fetchSessionPage(api as never, { dir: "/repo" })

    expect(api.calls).toEqual([
      { directory: "/repo", roots: true, archived: true, limit: SESSION_PAGE_LIMIT, cursor: undefined },
    ])
    expect(page.cursor).toBe(7)
  })

  it("ignores an empty or non-positive cursor header", async () => {
    const empty = client([{ id: "ses_1", time: { updated: 10 } }], "")
    expect((await fetchSessionPage(empty as never, { dir: "/repo" })).cursor).toBeUndefined()

    const zero = client([{ id: "ses_1", time: { updated: 10 } }], "0")
    expect((await fetchSessionPage(zero as never, { dir: "/repo" })).cursor).toBeUndefined()
  })

  it("returns no cursor when the header is missing", async () => {
    const api = client([{ id: "ses_1", time: { updated: 10 } }])
    const page = await fetchSessionPage(api as never, { dir: "/repo" })

    expect(page.cursor).toBeUndefined()
  })
})

describe("mergeSessions", () => {
  it("dedupes ids and sorts newest first", () => {
    const merged = mergeSessions([
      [{ id: "a", time: { updated: 1 } }],
      [
        { id: "b", time: { updated: 3 } },
        { id: "a", time: { updated: 2 } },
      ],
    ] as never)

    expect(merged.map((session) => session.id)).toEqual(["b", "a"])
  })
})
