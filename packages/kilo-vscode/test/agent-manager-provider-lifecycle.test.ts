import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ProjectContext } from "../src/agent-manager/project/context"
import {
  addSessionToLifecycleWorktree,
  closeLifecycleSession,
  createLifecycleWorktree,
  deleteLifecycleWorktree,
  removeStaleLifecycleWorktree,
  type LifecycleHost,
} from "../src/agent-manager/provider-lifecycle"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

describe("Agent Manager worktree lifecycle", () => {
  let root: string
  let worktree: string
  let state: WorktreeStateManager
  let ctx: ProjectContext
  let calls: string[]
  let client: {
    session: {
      active: ReturnType<typeof mock>
      get: ReturnType<typeof mock>
      list: ReturnType<typeof mock>
      move: ReturnType<typeof mock>
      remove: ReturnType<typeof mock>
    }
    permission: { request: { list: ReturnType<typeof mock> } }
    form: { list: ReturnType<typeof mock> }
    rpc: () => { removeSnapshot: ReturnType<typeof mock> }
  }
  let host: LifecycleHost

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-delete-lifecycle-"))
    worktree = path.join(root, "worktree")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(worktree)
    calls = []
    state = new WorktreeStateManager(root, () => undefined)
    ctx = new ProjectContext("project", root, true, {
      log: () => undefined,
      state: () => state,
      worktrees: () =>
        ({
          reconcilePool: async () => {},
          warmPool: async () => {},
          detachWorktree: mock(async () => {
            calls.push("disk")
            return { done: Promise.resolve() }
          }),
        }) as never,
    })
    ctx.stateManager().addWorktree({ branch: "feature", path: worktree, parentBranch: "main" })
    client = {
      session: {
        active: mock(async () => ({})),
        get: mock(async ({ sessionID }: { sessionID: string }) => ({
          id: sessionID,
          location: { directory: worktree },
        })),
        list: mock(async () => ({ data: [], location: { directory: worktree } })),
        move: mock(async ({ sessionID }: { sessionID: string }) => {
          calls.push(`move:${sessionID}`)
        }),
        remove: mock(async () => true),
      },
      permission: { request: { list: mock(async () => ({ data: [] })) } },
      form: { list: mock(async () => ({ data: [] })) },
      rpc: () => ({ removeSnapshot: mock(async () => ({ removed: true })) }),
    }
    host = {
      createOnDisk: async () => null,
      hasScript: () => true,
      runSetup: async () => undefined,
      createSession: async () => null,
      notifyReady: () => undefined,
      abort: async (ids) => {
        calls.push(`abort:${ids.join(",")}`)
      },
      push: () => calls.push("push"),
      register: () => undefined,
      skipStats: () => calls.push("stats:skip"),
      unskipStats: () => calls.push("stats:unskip"),
      removePR: () => calls.push("pr"),
      removeRun: async () => {
        calls.push("run:remove")
      },
      clearRun: async () => {
        calls.push("run:clear")
        return true
      },
      forgetName: () => calls.push("name"),
      stopDiffs: () => calls.push("diff"),
      autoName: () => ({ enabled: false }),
      client: () => Promise.resolve(client as never),
      acquirePtyCleanup: async () => {
        calls.push("pty")
        return () => calls.push("pty:release")
      },
      post: (message) => calls.push(`post:${message.type}`),
      notify: (message) => calls.push(`notify:${message}`),
      log: () => undefined,
    }
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  const deleteWorktree = async () => deleteLifecycleWorktree(ctx, host, state.getWorktrees()[0]!.id)

  it("does not create the session until the setup script finishes", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const wt = state.getWorktrees().at(0)!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    host.runSetup = async () => {
      calls.push("setup:start")
      entered.resolve()
      await gate.promise
      calls.push("setup:end")
    }
    host.createSession = async () => {
      calls.push("session")
      return { id: "created" } as never
    }
    const pending = createLifecycleWorktree(ctx, host, {})
    await entered.promise
    expect(calls).toEqual(["setup:start"])
    gate.resolve()
    const result = await pending
    expect(calls).toEqual(["setup:start", "setup:end", "session"])
    expect(result?.session.id).toBe("created")
  })

  it("removes and persists a missing stale entry even when backend terminal cleanup fails", async () => {
    const id = state.getWorktrees().at(0)!.id
    state.addSession("first", id)
    state.addSession("second", id)
    ctx.stale.add(id)
    fs.rmdirSync(worktree)
    host.acquirePtyCleanup = async () => {
      calls.push("pty")
      throw new Error("directory not found")
    }

    await removeStaleLifecycleWorktree(ctx, host, id)
    await state.flush()

    expect(state.getWorktrees()).toEqual([])
    expect(state.getSessions()).toEqual([])
    expect(ctx.stale.has(id)).toBe(false)
    expect(calls).toEqual(["run:remove", "run:clear", "pty", "name", "diff", "push"])
    const saved = new WorktreeStateManager(root, () => undefined)
    await saved.load()
    expect(saved.getWorktrees()).toEqual([])
    expect(saved.getSessions()).toEqual([])
  })

  it("ignores stale removal for a worktree that is not marked stale", async () => {
    const id = state.getWorktrees().at(0)!.id

    await removeStaleLifecycleWorktree(ctx, host, id)

    expect(state.getWorktree(id)).toBeDefined()
    expect(calls).toEqual([])
  })

  it("acknowledges completion only after disk deletion, before pushing the removed state", async () => {
    const disk = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const id = state.getWorktrees().at(0)!.id
    const post = mock(host.post)
    host.post = post
    ctx.worktreeManager().detachWorktree = async () => {
      entered.resolve()
      await disk.promise
      return { done: Promise.resolve() }
    }
    const pending = deleteWorktree()
    await entered.promise
    expect(post).not.toHaveBeenCalled()
    expect(state.getWorktree(id)).toBeDefined()
    disk.resolve()
    await pending
    expect(post).toHaveBeenCalledWith({
      type: "agentManager.worktreeDeleted",
      projectId: ctx.id,
      worktreeId: id,
    })
    expect(calls.indexOf("post:agentManager.worktreeDeleted")).toBeLessThan(calls.indexOf("push"))
    expect(state.getWorktree(id)).toBeUndefined()
  })

  it.each(["busy", "retry"] as const)("refuses a %s session before cleanup", async (status) => {
    const session = state.addSession("session", state.getWorktrees()[0]!.id)
    client.session.active.mockResolvedValue({ [session.id]: { type: status } })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(session.worktreeId!)).toBeDefined()
    expect(client.session.active).toHaveBeenCalled()
    expect(client.permission.request.list).toHaveBeenCalledWith({ location: { directory: worktree } })
    expect(client.form.list).toHaveBeenCalledWith({ location: { directory: worktree } })
  })

  it.each(["permission", "form"] as const)("refuses a pending %s before cleanup", async (kind) => {
    const session = state.addSession("session", state.getWorktrees()[0]!.id)
    const list = kind === "permission" ? client.permission.request.list : client.form.list
    list.mockResolvedValue({ data: [{ id: kind, sessionID: session.id }] })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(session.worktreeId!)).toBeDefined()
  })

  it("fails closed before cleanup when an authoritative check fails", async () => {
    client.form.list.mockRejectedValue(new Error("backend unavailable"))

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktrees()).toHaveLength(1)
  })

  it.each(["removeRun", "clearRun", "acquirePtyCleanup"] as const)(
    "reports a %s failure without removing the worktree",
    async (method) => {
      const id = state.getWorktrees()[0]!.id
      const post = mock(host.post)
      host.post = post
      host[method] = mock(async () => {
        throw new Error("cleanup failed")
      })

      await deleteWorktree()

      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          code: "agentManager.worktreeDeleteFailed",
          projectId: ctx.id,
          worktreeId: id,
        }),
      )
      expect(calls).toContain("stats:unskip")
      expect(calls).not.toContain("disk")
      expect(state.getWorktrees()).toHaveLength(1)
    },
  )

  it("preserves state when the directory remains locked", async () => {
    const id = state.getWorktrees().at(0)!.id
    const post = mock(host.post)
    host.post = post
    ctx.worktreeManager().detachWorktree = mock(async () => {
      calls.push("disk")
      throw new Error("directory busy")
    })

    await deleteWorktree()

    expect(post).toHaveBeenCalledWith({
      type: "error",
      code: "agentManager.worktreeDeleteFailed",
      projectId: ctx.id,
      worktreeId: id,
      message: "Failed to delete worktree: directory busy",
    })
    expect(calls).toContain("stats:unskip")
    expect(calls.at(-1)).toBe("pty:release")
    expect(calls).not.toContain("post:agentManager.worktreeDeleted")
    expect(client.session.move).not.toHaveBeenCalled()
    expect(state.getWorktrees()).toHaveLength(1)
  })

  it("closes a session by interrupting it before dropping its state", async () => {
    state.addSession("closed", state.getWorktrees()[0]!.id)

    await closeLifecycleSession(ctx, host, "closed")

    expect(calls).toEqual(["abort:closed", "push"])
    expect(state.getSession("closed")).toBeUndefined()
  })

  it("still interrupts a closed session when the project has no state", async () => {
    await closeLifecycleSession(
      {
        ...ctx,
        peekState: () => undefined,
      } as never,
      host,
      "closed",
    )

    expect(calls).toEqual(["abort:closed"])
  })

  it("moves retained and discovered sessions to the exact project root without deleting them", async () => {
    const first = state.addSession("first", state.getWorktrees()[0]!.id)
    const second = state.addSession("second", state.getWorktrees()[0]!.id)
    client.session.list.mockResolvedValue({
      data: [{ id: "archived" }, { id: "child" }],
      location: { directory: worktree },
    })

    await deleteWorktree()

    expect(calls).toEqual([
      "stats:skip",
      "diff",
      "run:remove",
      "run:clear",
      `abort:${first.id},${second.id}`,
      "pty",
      "disk",
      `move:${first.id}`,
      `move:${second.id}`,
      "move:archived",
      "move:child",
      "pr",
      "name",
      "post:agentManager.worktreeDeleted",
      "push",
      "pty:release",
    ])
    expect(client.session.remove).not.toHaveBeenCalled()
    expect(client.session.list).toHaveBeenCalledWith({
      directory: worktree,
      archived: true,
      parentID: null,
      limit: Number.MAX_SAFE_INTEGER,
    })
    for (const session of [first, second]) {
      expect(client.session.move).toHaveBeenCalledWith({ sessionID: session.id, directory: ctx.root })
    }
    expect(state.getWorktrees()).toHaveLength(0)
    expect(state.getSessions()).toHaveLength(0)
  })

  it("reports a snapshot cleanup failure without undoing the deletion", async () => {
    state.addSession("retained", state.getWorktrees()[0]!.id)
    client.rpc = () => ({
      removeSnapshot: mock(async () => {
        throw new Error("checkpoint cleanup failed")
      }),
    })
    const notify = mock(host.notify)
    host.notify = notify

    await deleteWorktree()
    await new Promise((resolve) => setImmediate(resolve))

    expect(notify).toHaveBeenCalledWith(
      "The worktree was deleted, but its checkpoint data could not be removed. Conversation history is preserved.",
    )
    expect(state.getWorktrees()).toHaveLength(0)
  })

  it("completes the deletion and reports when session relocation fails", async () => {
    state.addSession("retained", state.getWorktrees()[0]!.id)
    client.session.move.mockRejectedValue(new Error("move failed"))

    await deleteWorktree()

    expect(calls).toContain("disk")
    expect(calls).not.toContain("post:error")
    expect(calls).toContain("post:agentManager.worktreeDeleted")
    expect(calls).toContain(
      "notify:The worktree was deleted, but some conversations could not be moved to Local. Conversation history is preserved.",
    )
    expect(state.getWorktrees()).toHaveLength(0)
  })

  it("adds an existing session to the worktree it runs in", async () => {
    const id = state.getWorktrees()[0]!.id

    await addSessionToLifecycleWorktree(ctx, host, id, "existing")

    expect(state.getSession("existing")?.worktreeId).toBe(id)
    expect(calls).toContain("post:agentManager.sessionAdded")
  })

  it("files a session under the other worktree that runs it instead of the requested one", async () => {
    const owner = state.getWorktrees()[0]!.id
    const requested = state.addWorktree({ branch: "other", path: path.join(root, "other"), parentBranch: "main" }).id
    fs.mkdirSync(path.join(root, "other"))
    client.session.get.mockResolvedValue({ id: "elsewhere", location: { directory: worktree } })

    await addSessionToLifecycleWorktree(ctx, host, requested, "elsewhere")

    expect(state.getSession("elsewhere")?.worktreeId).toBe(owner)
    expect(calls).toContain("post:agentManager.sessionAdded")
  })

  it("files a session that runs in the project root under Local", async () => {
    const id = state.getWorktrees()[0]!.id
    state.addSession("elsewhere", null)
    client.session.get.mockResolvedValue({ id: "elsewhere", location: { directory: root } })

    await addSessionToLifecycleWorktree(ctx, host, id, "elsewhere")

    expect(state.getSession("elsewhere")?.worktreeId).toBeNull()
    expect(calls).toContain("post:agentManager.sessionAdded")
  })
})
