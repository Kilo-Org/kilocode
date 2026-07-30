import { describe, expect, it } from "bun:test"
import { handleSessionSearch } from "../../src/kilo-provider/session-search"

type Query = Record<string, unknown>

function stub(data: Array<Record<string, unknown>> | Error) {
  const calls: Query[] = []
  const client = {
    experimental: {
      session: {
        list: async (query: Query) => {
          calls.push(query)
          if (data instanceof Error) throw data
          return { data }
        },
      },
    },
  }
  return { calls, client }
}

function session(id: string, title: string, updated: number, worktreeName?: string) {
  return { id, title, time: { updated }, worktreeName }
}

describe("handleSessionSearch", () => {
  it("lists root sessions across the worktree family for the resolved directory", async () => {
    const { calls, client } = stub([session("ses_a", "Alpha", 2, "neon-author")])
    const posted: unknown[] = []

    await handleSessionSearch({
      client: client as never,
      message: { requestId: "r1", sessionID: "ses_current" },
      dir: (id) => (id === "ses_current" ? "/repo/.kilo/worktrees/wt-1" : "/repo"),
      post: (msg) => posted.push(msg),
    })

    expect(calls).toEqual([{ worktrees: true, roots: true, directory: "/repo/.kilo/worktrees/wt-1", limit: 50 }])
    expect(posted).toEqual([
      {
        type: "sessionSearchResult",
        sessions: [{ id: "ses_a", title: "Alpha", updated: 2, worktreeName: "neon-author" }],
        requestId: "r1",
      },
    ])
  })

  it("falls back to the current and context sessions for directory resolution", async () => {
    const { calls, client } = stub([])

    await handleSessionSearch({
      client: client as never,
      message: { requestId: "r2" },
      current: "ses_current",
      context: "ses_context",
      dir: (id) => `/dir/${id}`,
      post: () => {},
    })

    expect(calls[0]?.directory).toBe("/dir/ses_current")

    await handleSessionSearch({
      client: client as never,
      message: { requestId: "r3" },
      context: "ses_context",
      dir: (id) => `/dir/${id}`,
      post: () => {},
    })

    expect(calls[1]?.directory).toBe("/dir/ses_context")
  })

  it("excludes the given session and sessions without titles", async () => {
    const { client } = stub([
      session("ses_keep", "Keep", 3),
      session("ses_exclude", "Excluded", 2),
      session("ses_untitled", "", 1),
    ])
    const posted: Array<{ sessions: Array<{ id: string }> }> = []

    await handleSessionSearch({
      client: client as never,
      message: { requestId: "r4" },
      dir: () => "/repo",
      exclude: "ses_exclude",
      post: (msg) => posted.push(msg as never),
    })

    expect(posted[0]?.sessions.map((s) => s.id)).toEqual(["ses_keep"])
  })

  it("posts an empty result when the client is missing or the list fails", async () => {
    const posted: unknown[] = []

    await handleSessionSearch({
      client: null,
      message: { requestId: "r5" },
      dir: () => "/repo",
      post: (msg) => posted.push(msg),
    })

    const failing = stub(new Error("boom"))
    await handleSessionSearch({
      client: failing.client as never,
      message: { requestId: "r6" },
      dir: () => "/repo",
      post: (msg) => posted.push(msg),
    })

    expect(posted).toEqual([
      { type: "sessionSearchResult", sessions: [], requestId: "r5" },
      { type: "sessionSearchResult", sessions: [], requestId: "r6" },
    ])
  })
})
