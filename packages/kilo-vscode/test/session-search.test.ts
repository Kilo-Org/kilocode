import { describe, expect, it } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { handleSessionSearch, worktreeFamily } from "../src/kilo-provider/session-search"
import { exec } from "../src/util/process"

type Query = Record<string, unknown>

const ROOTS = ["/repo", "/repo/.kilo/worktrees/wt-1", "/pool/neon-author"]

function stub(data: Array<Record<string, unknown>> | Error) {
  const calls: Query[] = []
  const locations: Query[] = []
  const client = {
    location: {
      get: async (query: Query) => {
        locations.push(query)
        return { directory: "/repo", project: { id: "prj_repo", directory: "/repo", canonical: "/repo" } }
      },
    },
    session: {
      list: async (query: Query) => {
        calls.push(query)
        if (data instanceof Error) throw data
        return { data, cursor: {} }
      },
    },
  }
  return { calls, locations, client }
}

function session(id: string, title: string, updated: number, directory = "/repo") {
  return { id, title, time: { updated }, location: { directory } }
}

describe("handleSessionSearch", () => {
  it("lists the project's root sessions across the worktree family of the requested directory", async () => {
    const { calls, locations, client } = stub([
      session("ses_a", "Alpha", 2, "/pool/neon-author"),
      session("ses_b", "Beta", 1, "/repo/.kilo/worktrees/wt-1/packages/app"),
      session("ses_c", "Gamma", 0, "/repo/src"),
    ])
    const posted: unknown[] = []

    await handleSessionSearch({
      client: client as never,
      message: { type: "requestSessionSearch", requestId: "r1", sessionID: "ses_current", directory: ROOTS[1] },
      directory: "/repo",
      family: async () => ROOTS,
      post: (msg) => posted.push(msg),
    })

    expect(locations).toEqual([{ location: { directory: ROOTS[1] } }])
    expect(calls).toEqual([{ project: "prj_repo", parentID: null, archived: false, limit: 5_000 }])
    expect(posted).toEqual([
      {
        type: "sessionSearchResult",
        sessions: [
          { id: "ses_a", title: "Alpha", updated: 2, worktreeName: "neon-author" },
          // A worktree nested in the repo names its own folder, not the repo's.
          { id: "ses_b", title: "Beta", updated: 1, worktreeName: "wt-1" },
          { id: "ses_c", title: "Gamma", updated: 0, worktreeName: "repo" },
        ],
        requestId: "r1",
      },
    ])
  })

  it("searches the host directory when the request names none", async () => {
    const { locations, client } = stub([])
    const dirs: string[] = []

    await handleSessionSearch({
      client: client as never,
      message: { type: "requestSessionSearch", requestId: "r2" },
      directory: "/repo",
      family: async (dir) => {
        dirs.push(dir)
        return ROOTS
      },
      post: () => {},
    })

    expect(locations).toEqual([{ location: { directory: "/repo" } }])
    expect(dirs).toEqual(["/repo"])
  })

  it("excludes the requesting session, sessions without titles and sessions outside the family", async () => {
    const { client } = stub([
      session("ses_keep", "Keep", 3),
      session("ses_exclude", "Excluded", 2),
      session("ses_untitled", "", 1),
      session("ses_other", "Other checkout", 1, "/elsewhere/repo"),
    ])
    const posted: Array<{ sessions: Array<{ id: string }> }> = []

    await handleSessionSearch({
      client: client as never,
      message: { type: "requestSessionSearch", requestId: "r4", sessionID: "ses_exclude" },
      directory: "/repo",
      family: async () => ROOTS,
      post: (msg) => posted.push(msg as never),
    })

    expect(posted[0]?.sessions.map((s) => s.id)).toEqual(["ses_keep"])
  })

  it.each(["/repo", "/repo/.kilo/worktrees/wt-1"])("loads older chats in one request from %s", async (dir) => {
    const recent = Array.from({ length: 60 }, (_, index) => session(`ses_${index}`, `Recent ${index}`, 2, ROOTS[1]))
    const source = session("ses_old", "Older chat", 1, "/repo")
    const api = stub([...recent, source])
    const posted: Array<{ sessions: Array<{ id: string }> }> = []

    await handleSessionSearch({
      client: api.client as never,
      message: { type: "requestSessionSearch", requestId: "all", sessionID: "ses_current", directory: dir },
      directory: "/wrong-project",
      family: async () => ROOTS,
      post: (msg) => posted.push(msg as never),
    })

    expect(api.calls).toHaveLength(1)
    expect(posted).toHaveLength(1)
    expect(posted[0]?.sessions.map((item) => item.id)).toEqual([...recent.map((item) => item.id), source.id])
  })

  it("posts an empty result when the client is missing or the list fails", async () => {
    const posted: unknown[] = []

    await handleSessionSearch({
      client: null,
      message: { type: "requestSessionSearch", requestId: "r5" },
      directory: "/repo",
      family: async () => ROOTS,
      post: (msg) => posted.push(msg),
    })

    const failing = stub(new Error("boom"))
    await handleSessionSearch({
      client: failing.client as never,
      message: { type: "requestSessionSearch", requestId: "r6" },
      directory: "/repo",
      family: async () => ROOTS,
      post: (msg) => posted.push(msg),
    })

    expect(posted).toEqual([
      { type: "sessionSearchResult", sessions: [], requestId: "r5" },
      { type: "sessionSearchResult", sessions: [], requestId: "r6" },
    ])
  })
})

describe("worktreeFamily", () => {
  it("lists the repository and its linked worktrees from either checkout", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-family-")))
    const repo = path.join(root, "repo")
    const linked = path.join(root, "linked")
    try {
      await exec("git", ["init", "-q", repo])
      await exec("git", [
        "-C",
        repo,
        "-c",
        "user.name=Kilo",
        "-c",
        "user.email=kilo@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init",
      ])
      await exec("git", ["-C", repo, "worktree", "add", "-q", "-b", "feature", linked])

      expect((await worktreeFamily(repo)).toSorted()).toEqual([linked, repo].toSorted())
      expect((await worktreeFamily(path.join(linked))).toSorted()).toEqual([linked, repo].toSorted())
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("is the directory alone outside git", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-family-")))
    try {
      expect(await worktreeFamily(root)).toEqual([root])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
