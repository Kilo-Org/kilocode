import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SessionInfo } from "@opencode/client"
import { fileMovedSession, moveSession } from "../src/agent-manager/session-move"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

function session(directory: string): SessionInfo {
  return { id: "ses_1", location: { directory } } as SessionInfo
}

describe("agent manager session move", () => {
  it("resolves only after the move is applied and its drain has settled", async () => {
    const states = [
      { directory: "/repo", active: { ses_1: { type: "running" } } },
      { directory: "/repo/wt", active: { ses_1: { type: "running" } } },
      { directory: "/repo/wt", active: {} },
    ]
    const reads = { count: 0 }
    const current = () => states[Math.min(reads.count, states.length - 1)]!
    const move = async () => undefined
    const client = {
      session: {
        move,
        get: async () => session(current().directory),
        active: async () => {
          const value = current().active
          reads.count++
          return value
        },
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt")

    expect(reads.count).toBe(3)
    expect(moved.session.location.directory).toBe("/repo/wt")
    expect(moved.landed).toBe(true)
    expect(moved.settled).toBe(true)
  })

  it("reports the last record it saw when the move does not land in time", async () => {
    const client = {
      session: {
        move: async () => undefined,
        get: async () => session("/repo"),
        active: async () => ({ ses_1: { type: "running" } }),
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt", 0)

    expect(moved.session.location.directory).toBe("/repo")
    expect(moved.landed).toBe(false)
    expect(moved.settled).toBe(false)
  })

  it("reports a landed move whose drain still runs, so the caller can file it", async () => {
    const client = {
      session: {
        move: async () => undefined,
        get: async () => session("/repo/wt"),
        active: async () => ({ ses_1: { type: "running" } }),
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt", 0)

    expect(moved.session.location.directory).toBe("/repo/wt")
    expect(moved.landed).toBe(true)
    expect(moved.settled).toBe(false)
  })

  it("does not fail the move when its reads fail", async () => {
    const client = {
      session: {
        move: async () => undefined,
        get: async () => {
          throw new Error("read failed")
        },
        active: async () => ({}),
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt", 0)

    expect(moved.session.id).toBe("ses_1")
    expect(moved.session.location.directory).toBe("/repo")
    expect(moved.landed).toBe(false)
  })
})

describe("fileMovedSession", () => {
  let root: string
  let worktree: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-moved-file-")))
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    state = new WorktreeStateManager(root, () => undefined)
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("files a session the server moved to the project root under Local", () => {
    const wt = state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" })
    state.addSession("ses_1", wt.id)

    expect(fileMovedSession(state, "ses_1", root, root)).toBe(true)
    expect(state.getSession("ses_1")?.worktreeId).toBeNull()
  })

  it("files a session the server moved into a worktree under that worktree", () => {
    const wt = state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" })
    state.addSession("ses_1", null)

    expect(fileMovedSession(state, "ses_1", worktree, root)).toBe(true)
    expect(state.getSession("ses_1")?.worktreeId).toBe(wt.id)
  })

  it("leaves a filing alone when it already matches the server directory", () => {
    state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" })
    state.addSession("ses_1", null)

    expect(fileMovedSession(state, "ses_1", root, root)).toBe(false)
    expect(state.getSession("ses_1")?.worktreeId).toBeNull()
  })

  it("leaves a filing alone for an untracked directory or an unknown session", () => {
    const wt = state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" })
    state.addSession("ses_1", wt.id)

    expect(fileMovedSession(state, "ses_1", path.join(root, "elsewhere"), root)).toBe(false)
    expect(state.getSession("ses_1")?.worktreeId).toBe(wt.id)
    expect(fileMovedSession(state, "unknown", root, root)).toBe(false)
  })
})
