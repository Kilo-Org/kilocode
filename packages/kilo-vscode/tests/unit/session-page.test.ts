import { describe, expect, it } from "bun:test"
import { fetchSessionPage, mergeSessions, SESSION_PAGE_LIMIT } from "../../src/kilo-provider/session-page"

type Item = { id: string; time: { updated: number } }

function client(data: Item[], cursor?: number) {
  const calls: Array<Record<string, unknown>> = []
  const headers = new Headers()
  if (cursor != null) headers.set("x-next-cursor", String(cursor))
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
    const api = client([{ id: "ses_1", time: { updated: 10 } }], 7)
    const page = await fetchSessionPage(api as never, { dir: "/repo" })

    expect(api.calls).toEqual([
      { directory: "/repo", roots: true, archived: true, limit: SESSION_PAGE_LIMIT, cursor: undefined },
    ])
    expect(page.cursor).toBe(7)
  })

  it("synthesizes a cursor when the header is missing but the page is full", async () => {
    const data = Array.from({ length: SESSION_PAGE_LIMIT }, (_, index) => ({
      id: `ses_${index}`,
      time: { updated: 100 - index },
    }))
    const api = client(data)
    const page = await fetchSessionPage(api as never, { dir: "/repo", cursor: 500 })

    expect(page.cursor).toBe(100 - (SESSION_PAGE_LIMIT - 1))
  })

  it("returns no cursor when the header is missing and the page is partial", async () => {
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
