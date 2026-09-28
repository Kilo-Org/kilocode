import { describe, expect, it } from "bun:test"
import { createKiloClient, type SessionBoard } from "@kilocode/sdk/v2/client"
import { ProjectRouteService } from "../../src/agent-manager/project/route"
import * as Board from "../../src/kilo-provider/session-board"

const snapshot: SessionBoard = { ownerSessionID: "ses_owner", revision: 12, messages: [], hasMore: false }

function setup(reply = () => Response.json(snapshot)) {
  const calls: Request[] = []
  const posts: unknown[] = []
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(input instanceof Request ? input : new Request(input, init))
      return reply()
    },
    { preconnect: globalThis.fetch.preconnect },
  ) satisfies typeof globalThis.fetch
  const ctx: Parameters<typeof Board.handle>[1] = {
    client: createKiloClient({ baseUrl: "http://localhost", fetch }),
    directories: new Map([["ses_owner", "/repo/worktree"]]),
    session: null,
    post: (message) => posts.push(message),
  }
  return { ctx, calls, posts }
}

function projects() {
  const routes = new ProjectRouteService()
  for (const projectId of ["alpha", "beta"]) {
    routes.registerProject(projectId, `/${projectId}`, 1)
    routes.registerSession({ projectId, sessionId: "ses_owner" }, `/${projectId}/worktree`, 1)
  }
  return routes
}

describe("session board requests", () => {
  it("loads the requested page from the session directory", async () => {
    const state = setup()
    await Board.handle(
      { type: "requestSessionBoard", sessionID: "ses_owner", requestID: "page", before: "board_before", limit: 10 },
      state.ctx,
    )
    const request = state.calls.at(0)!
    const url = new URL(request.url)
    expect(request.method).toBe("GET")
    expect(url.pathname).toBe("/kilocode/session/ses_owner/board")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      directory: "/repo/worktree",
      before: "board_before",
      limit: "10",
    })
    expect(state.posts).toEqual([
      { type: "sessionBoardLoaded", sessionID: "ses_owner", requestID: "page", board: snapshot },
    ])
  })

  it.each(["/alpha", "/alpha-worktree"])(
    "uses the new session directory %s before its route is registered",
    async (directory) => {
      const state = setup()
      state.ctx.routes = new ProjectRouteService()
      state.ctx.routes.registerProject("alpha", "/alpha", 1)
      state.ctx.projectId = "alpha"
      state.ctx.directories = new Map([["ses_owner", directory]])
      state.ctx.session = { id: "ses_owner", directory }
      for (const type of ["requestSessionBoard", "resetSessionBoard"]) {
        await Board.handle(
          { type, sessionID: "ses_owner", requestID: type, projectId: "alpha", revision: 12 },
          state.ctx,
        )
      }
      expect(state.calls).toHaveLength(2)
      for (const request of state.calls) expect(new URL(request.url).searchParams.get("directory")).toBe(directory)
      for (const post of state.posts) expect(post).toMatchObject({ projectId: "alpha", board: snapshot })
    },
  )

  it("keeps reset tied to the captured project and revision", async () => {
    const state = setup()
    state.ctx.routes = projects()
    state.ctx.projectId = "beta"
    await Board.handle(
      { type: "resetSessionBoard", sessionID: "ses_owner", requestID: "reset", projectId: "alpha", revision: 12 },
      state.ctx,
    )
    const request = state.calls.at(0)!
    const url = new URL(request.url)
    expect(request.method).toBe("POST")
    expect(url.pathname).toBe("/kilocode/session/ses_owner/board/reset")
    expect(url.searchParams.get("directory")).toBe("/alpha/worktree")
    expect(await request.json()).toEqual({ revision: 12 })
    expect(state.posts).toEqual([
      { type: "sessionBoardLoaded", sessionID: "ses_owner", requestID: "reset", projectId: "alpha", board: snapshot },
    ])
  })

  it("refuses ambiguous or stale routes instead of using a directory fallback", async () => {
    const state = setup()
    state.ctx.routes = projects()
    for (const projectId of [undefined, "missing"]) {
      await Board.handle(
        { type: "resetSessionBoard", sessionID: "ses_owner", requestID: "reset", projectId, revision: 12 },
        state.ctx,
      )
    }
    state.ctx.routes.unregisterSession({ projectId: "alpha", sessionId: "ses_owner" })
    state.ctx.directories = new Map([["ses_owner", "/beta"]])
    state.ctx.projectId = "beta"
    state.ctx.session = { id: "ses_owner", directory: "/beta" }
    await Board.handle(
      { type: "resetSessionBoard", sessionID: "ses_owner", requestID: "reset", projectId: "alpha", revision: 12 },
      state.ctx,
    )
    expect(state.calls).toHaveLength(0)
    expect(state.posts).toHaveLength(3)
    for (const post of state.posts) expect(post).toMatchObject({ requestID: "reset", error: expect.any(String) })
  })

  it("reports a changed board without retrying the reset", async () => {
    const state = setup(() =>
      Response.json({ name: "ConflictError", data: { message: "The board changed. Refresh it." } }, { status: 409 }),
    )
    await Board.handle(
      { type: "resetSessionBoard", sessionID: "ses_owner", requestID: "reset", revision: 11 },
      state.ctx,
    )
    expect(state.calls).toHaveLength(1)
    expect(state.posts).toEqual([
      expect.objectContaining({
        type: "sessionBoardLoaded",
        requestID: "reset",
        error: expect.stringContaining("board changed"),
      }),
    ])
  })
})
