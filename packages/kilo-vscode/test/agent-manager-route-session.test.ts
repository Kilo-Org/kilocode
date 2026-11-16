import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileSessionLocally, routeSession } from "../src/agent-manager/route-session"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

describe("routeSession", () => {
  let root: string
  let worktree: string
  let directory: string
  let client: {
    session: { get: ReturnType<typeof mock>; move: ReturnType<typeof mock>; active: ReturnType<typeof mock> }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-route-"))
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    directory = worktree
    client = {
      session: {
        get: mock(async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory } })),
        move: mock(async ({ directory: next }: { directory: string }) => {
          directory = next
        }),
        active: mock(async () => ({})),
      },
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("moves a worktree session opened locally to the project root", async () => {
    expect(await routeSession(client as never, "ses_1", root, () => undefined)).toBe(true)

    expect(client.session.move).toHaveBeenCalledWith({ sessionID: "ses_1", directory: root })
    expect(directory).toBe(root)
  })

  it("leaves a session that already runs in the project root alone", async () => {
    directory = root

    expect(await routeSession(client as never, "ses_1", `${root}/`, () => undefined)).toBe(true)

    expect(client.session.move).not.toHaveBeenCalled()
  })

  it("reports a failed read or move so the caller keeps the filing", async () => {
    const logs: unknown[][] = []
    client.session.get.mockRejectedValueOnce(new Error("offline"))
    expect(await routeSession(client as never, "ses_1", root, (...args) => logs.push(args))).toBe(false)
    client.session.get.mockResolvedValueOnce({ id: "ses_1", location: { directory: worktree } })
    client.session.move.mockRejectedValueOnce(new Error("move failed"))
    expect(await routeSession(client as never, "ses_1", root, (...args) => logs.push(args))).toBe(false)

    expect(logs).toHaveLength(2)
    expect(directory).toBe(worktree)
  })
})

describe("fileSessionLocally", () => {
  let root: string
  let state: WorktreeStateManager
  let client: {
    session: { get: ReturnType<typeof mock>; move: ReturnType<typeof mock>; active: ReturnType<typeof mock> }
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-file-local-")))
    state = new WorktreeStateManager(root, () => undefined)
    const worktree = state.addWorktree({ branch: "one", path: path.join(root, "one"), parentBranch: "main" })
    state.addSession("ses_1", worktree.id)
    client = {
      session: {
        get: mock(async () => ({ id: "ses_1", location: { directory: worktree.path } })),
        move: mock(async () => {
          throw new Error("move failed")
        }),
        active: mock(async () => ({})),
      },
    }
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("keeps the worktree filing when the server cannot move the session", async () => {
    const filed = await fileSessionLocally({
      client: client as never,
      state,
      sessionId: "ses_1",
      root,
      log: () => undefined,
    })

    expect(filed).toBe(false)
    expect(state.getSession("ses_1")?.worktreeId).not.toBeNull()
  })

  it("files the session under Local once the server runs it in the project root", async () => {
    const moved = { id: "ses_1", location: { directory: root } }
    client.session.move.mockResolvedValueOnce(undefined)
    client.session.get
      .mockResolvedValueOnce({ id: "ses_1", location: { directory: path.join(root, "one") } })
      .mockResolvedValueOnce(moved)

    expect(
      await fileSessionLocally({ client: client as never, state, sessionId: "ses_1", root, log: () => undefined }),
    ).toBe(true)
    expect(state.getSession("ses_1")?.worktreeId).toBeNull()
  })
})
