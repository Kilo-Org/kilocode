import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { OpenCode } from "@opencode/client"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { simpleGit } from "simple-git"
import { ProjectContext } from "../src/agent-manager/project/context"
import { pushProjectSessions } from "../src/agent-manager/project/init"
import {
  addSessionToLifecycleWorktree,
  closeLifecycleSession,
  promoteLifecycleSession,
  createLifecycleWorktree,
  deleteLifecycleWorktree,
  removeStaleLifecycleWorktree,
  type LifecycleHost,
} from "../src/agent-manager/provider-lifecycle"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import { WorktreeManager } from "../src/agent-manager/WorktreeManager"
import { fileSessionLocally } from "../src/agent-manager/route-session"
import { restoreWorktrees } from "../src/agent-manager/state-recovery"
import { command, start, stop } from "../src/server"

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

  it("moves kept sessions of a removed stale worktree to the project root on the server", async () => {
    const id = state.getWorktrees().at(0)!.id
    state.addSession("first", id)
    state.addSession("second", id)
    ctx.stale.add(id)
    fs.rmdirSync(worktree)

    await removeStaleLifecycleWorktree(ctx, host, id, true)

    expect(client.session.move).toHaveBeenCalledWith({ sessionID: "first", directory: ctx.root })
    expect(client.session.move).toHaveBeenCalledWith({ sessionID: "second", directory: ctx.root })
    expect(state.getSessions().map((session) => [session.id, session.worktreeId])).toEqual([
      ["first", null],
      ["second", null],
    ])
    expect(calls).toContain("abort:first,second")
    expect(calls.indexOf("abort:first,second")).toBeLessThan(calls.indexOf("move:first"))
    expect(calls.indexOf("move:first")).toBeLessThan(calls.indexOf("push"))
  })

  it("does not move sessions when a stale worktree is removed without keeping them", async () => {
    const id = state.getWorktrees().at(0)!.id
    state.addSession("first", id)
    ctx.stale.add(id)

    await removeStaleLifecycleWorktree(ctx, host, id)

    expect(client.session.move).not.toHaveBeenCalled()
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

  it("refuses a running session before cleanup", async () => {
    const session = state.addSession("session", state.getWorktrees()[0]!.id)
    client.session.list.mockResolvedValue({ data: [session] })
    client.session.active.mockResolvedValue({ [session.id]: { type: "running" } })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(session.worktreeId!)).toBeDefined()
    expect(client.session.active).toHaveBeenCalled()
    expect(client.permission.request.list).toHaveBeenCalledWith({ location: { directory: worktree } })
    expect(client.form.list).toHaveBeenCalledWith({ location: { directory: worktree } })
  })

  it("refuses deletion when an unfiled child in the worktree is running", async () => {
    const id = state.getWorktrees()[0]!.id
    client.session.list.mockResolvedValue({ data: [{ id: "child", parentID: "parent" }] })
    client.session.active.mockResolvedValue({ child: { type: "running" } })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(id)).toBeDefined()
  })

  it("refuses deletion when a filed session is running in a worktree subdirectory", async () => {
    const id = state.getWorktrees()[0]!.id
    state.addSession("nested", id)
    const nested = path.join(worktree, "nested")
    fs.mkdirSync(nested)
    client.session.get.mockResolvedValue({ id: "nested", location: { directory: nested } })
    client.session.active.mockResolvedValue({ nested: { type: "running" } })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(id)).toBeDefined()
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

  it("keeps the first worktree tab closed on restart and lets History reopen it", async () => {
    const worktree = state.getWorktrees()[0]!
    state.addSession("closed", worktree.id)
    state.setTabOrder(worktree.id, ["closed", "other"])
    state.setActiveTarget({ projectId: ctx.id, kind: "session", sessionId: "closed" })

    await closeLifecycleSession(ctx, host, "closed")

    expect(calls).toEqual(["abort:closed", "push"])
    expect(state.getSession("closed")).toBeUndefined()
    // The webview derives worktree tabs from the filed session and its tab order, so both must drop the closed session.
    expect(state.getTabOrder()[worktree.id]).toEqual(["other"])

    await state.flush()
    const saved = JSON.parse(fs.readFileSync(path.join(root, ".kilo2", "agent-manager.json"), "utf8"))
    expect(saved.sessions.closed).toBeUndefined()
    expect(saved.tabOrder[worktree.id]).toEqual(["other"])

    const restored = new ProjectContext(ctx.id, root, true, { log: host.log })
    try {
      const loaded = restored.stateManager()
      await loaded.load()
      expect(loaded.isSessionClosed("closed")).toBe(true)
      expect(loaded.getActiveTarget()).toEqual({ projectId: ctx.id, kind: "worktree", worktreeId: worktree.id })
      restoreWorktrees(loaded, [{ ...worktree, sessionId: "closed", createdAt: Date.parse(worktree.createdAt) }])
      expect(loaded.getSession("closed")).toBeUndefined()

      // Selecting the conversation in History explicitly adds it back to its worktree.
      await addSessionToLifecycleWorktree(restored, host, worktree.id, "closed")
      expect(loaded.getSession("closed")?.worktreeId).toBe(worktree.id)
      expect(loaded.isSessionClosed("closed")).toBe(false)
    } finally {
      await restored.dispose()
    }
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

  it("does not interrupt or move a stale filing in a similarly named sibling directory", async () => {
    const first = state.addSession("first", state.getWorktrees()[0]!.id)
    const stale = state.addSession("stale", state.getWorktrees()[0]!.id)
    const sibling = `${worktree}-sibling`
    fs.mkdirSync(sibling)
    client.session.get.mockResolvedValue({ id: stale.id, location: { directory: sibling } })
    client.session.active.mockResolvedValue({ [stale.id]: { type: "running" } })
    client.session.list.mockResolvedValue({
      data: [{ id: first.id }, { id: "archived" }, { id: "child", parentID: first.id }],
      location: { directory: worktree },
    })

    await deleteWorktree()

    expect(calls).toEqual([
      "stats:skip",
      "diff",
      "run:remove",
      "run:clear",
      `abort:${first.id},archived,child`,
      "pty",
      "disk",
      `move:${first.id}`,
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
      limit: Number.MAX_SAFE_INTEGER,
    })
    expect(client.session.get).toHaveBeenCalledTimes(1)
    expect(client.session.get).toHaveBeenCalledWith({ sessionID: stale.id })
    expect(client.session.move).toHaveBeenCalledWith({ sessionID: first.id, directory: ctx.root })
    expect(client.session.move).not.toHaveBeenCalledWith({ sessionID: stale.id, directory: ctx.root })
    expect(state.getWorktrees()).toHaveLength(0)
    expect(state.getSessions()).toHaveLength(0)
  })

  it("reopens worktree conversations from Local History after deletion, including closed and nested sessions", async () => {
    const repo = path.join(fs.realpathSync(root), "repo")
    fs.mkdirSync(repo)
    const git = simpleGit(repo)
    await git.init(["-b", "main"])
    await git.raw([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ])
    const manager = new WorktreeManager(repo, host.log, undefined, undefined, 0)
    const tree = await manager.createWorktree({ branchName: "history" })
    const project = new ProjectContext("history", repo, true, { log: host.log, worktrees: () => manager })
    const saved = project.stateManager()
    const wt = saved.addWorktree({ branch: tree.branch, path: tree.path, parentBranch: "main" })
    const found = command({ extension: path.resolve(import.meta.dir, ".."), storage: root, env: {} })
    if (!found) throw new Error("dev entry not found")
    const server = await start({ command: found, cwd: repo, env: process.env })
    try {
      const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
      host.client = async () => api
      host.abort = async (ids) => {
        await Promise.all(ids.map((sessionID) => api.session.interrupt({ sessionID })))
      }
      const time = Date.now()
      const conversation = (title: string, archived?: number, directory = tree.path) =>
        api.experimental.session.import({
          location: { directory },
          info: {
            id: Session.ID.create(),
            projectID: "global",
            location: { directory },
            title,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: time, updated: time, archived },
          },
          messages: [{ id: SessionMessage.ID.create(), type: "user", text: title, time: { created: time } }],
        })
      const open = await conversation("Open transcript")
      const closed = await conversation("Closed transcript")
      const archived = await conversation("Archived transcript", time)
      const child = await api.session.create({ parentID: closed.id })
      const subdirectory = path.join(tree.path, "nested")
      fs.mkdirSync(subdirectory)
      const nested = await conversation("Nested transcript", undefined, subdirectory)
      saved.addSession(open.id, wt.id)
      saved.addSession(closed.id, wt.id)
      saved.addSession(nested.id, wt.id)
      await closeLifecycleSession(project, host, closed.id)
      expect(saved.getSession(closed.id)).toBeUndefined()
      const list = async (directory: string) => (await api.session.list({ directory, parentID: null })).data
      await pushProjectSessions(project, list, host.post, host.log)
      expect(project.sessions().find((entry) => entry.id === closed.id)?.worktreeId).toBe(wt.id)

      await deleteLifecycleWorktree(project, host, wt.id)
      expect(fs.existsSync(tree.path)).toBe(false)
      await pushProjectSessions(project, list, host.post, host.log)
      const history = project.sessions().filter((entry) => entry.worktreeId === null)
      expect(history.map((entry) => entry.id).sort()).toEqual([open.id, closed.id, archived.id, nested.id].sort())
      for (const entry of history) {
        expect(
          await fileSessionLocally({ client: api, state: saved, sessionId: entry.id, root: repo, log: host.log }),
        ).toBe("moved")
        expect(saved.getSession(entry.id)?.worktreeId).toBeNull()
        const transcript = await api.message.list({ sessionID: entry.id, type: "user" })
        expect(transcript.data).toMatchObject([{ type: "user", text: entry.title }])
      }
      expect((await api.session.get({ sessionID: archived.id })).time.archived).toBe(time)
      expect((await api.session.get({ sessionID: child.id })).location.directory).toBe(repo)
    } finally {
      await project.dispose()
      const exited = new Promise((resolve) => server.process.once("exit", resolve))
      stop(server.process)
      await exited
    }
  }, 120_000)

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

  it("does not report a failure when the worktree had no checkpoint data", async () => {
    client.rpc = () => ({ removeSnapshot: mock(async () => ({ removed: false })) })
    const notify = mock(host.notify)
    host.notify = notify

    await deleteWorktree()
    await new Promise((resolve) => setImmediate(resolve))

    expect(notify).not.toHaveBeenCalled()
    expect(state.getWorktrees()).toHaveLength(0)
  })

  it("completes the deletion and reports when session relocation fails", async () => {
    const retained = state.addSession("retained", state.getWorktrees()[0]!.id)
    client.session.list.mockResolvedValue({ data: [retained] })
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

  it("files a promoted session under the new worktree once the server moved it", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    state.addSession("promoted", null)
    const synthetic = mock(async () => ({}))
    ;(client.session as unknown as { synthetic: typeof synthetic }).synthetic = synthetic

    await promoteLifecycleSession(ctx, host, "promoted")

    expect(client.session.move).toHaveBeenCalledWith({ sessionID: "promoted", directory: worktree })
    expect(state.getSession("promoted")?.worktreeId).toBe(wt.id)
    expect(synthetic).toHaveBeenCalled()
  })

  it("stops a promoted session and files it only once the move landed, without starting a reply", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    state.addSession("promoted", null)
    const moved = { done: false }
    client.session.move.mockImplementation(async ({ sessionID }: { sessionID: string }) => {
      calls.push(`move:${sessionID}`)
      moved.done = true
    })
    client.session.get.mockImplementation(async ({ sessionID }: { sessionID: string }) => {
      calls.push(`get:${state.getSession(sessionID)?.worktreeId ?? "local"}`)
      return { id: sessionID, location: { directory: moved.done ? worktree : root } }
    })
    const synthetic = mock(async (_input: { resume?: boolean }) => ({}))
    ;(client.session as unknown as { synthetic: typeof synthetic }).synthetic = synthetic

    await promoteLifecycleSession(ctx, host, "promoted")

    expect(calls).toContain("abort:promoted")
    expect(calls.indexOf("abort:promoted")).toBeLessThan(calls.indexOf("move:promoted"))
    // The session stays in Local until the server reports the worktree directory.
    expect(calls.filter((call) => call.startsWith("get:"))).toEqual(["get:local", "get:local"])
    expect(state.getSession("promoted")?.worktreeId).toBe(wt.id)
    expect(synthetic.mock.calls[0]?.[0]?.resume).toBe(false)
  })

  it("keeps a promoted session in Local when the server cannot move it", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    host.notifyReady = mock(() => undefined)
    state.addSession("promoted", null)
    client.session.move.mockRejectedValue(new Error("move failed"))

    await promoteLifecycleSession(ctx, host, "promoted")

    expect(state.getSession("promoted")?.worktreeId).toBeNull()
    expect(calls).toContain("post:agentManager.worktreeSetup")
    expect(host.notifyReady).not.toHaveBeenCalled()
    // The worktree created for the promotion is removed again.
    expect(calls).toContain("disk")
    expect(state.getWorktree(wt.id)).toBeUndefined()
  })

  it("keeps the new worktree and reports the queued move instead of failing", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    host.notifyReady = mock(() => undefined)
    const post = mock(host.post)
    host.post = post
    state.addSession("promoted", null)
    // The server queued the move, but the session still runs in the root when the deadline passes.
    client.session.get.mockResolvedValue({ id: "promoted", location: { directory: root } })
    client.session.active.mockImplementation(async () => {
      setSystemTime(new Date(Date.now() + 60_000))
      return { promoted: { type: "running" } }
    })

    try {
      await promoteLifecycleSession(ctx, host, "promoted")
    } finally {
      setSystemTime()
    }

    expect(calls).toContain("move:promoted")
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentManager.worktreeSetup",
        status: "ready",
        worktreeId: wt.id,
        message: expect.stringContaining("moves here when its current step finishes"),
      }),
    )
    expect(calls).toContain("push")
    expect(calls).not.toContain("disk")
    expect(state.getWorktree(wt.id)).toBeDefined()
    expect(state.getSession("promoted")?.worktreeId).toBeNull()
    expect(host.notifyReady).not.toHaveBeenCalled()
  })

  it("clears the setup state when the promoted session was closed before it could be filed", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    host.notifyReady = mock(() => undefined)
    const post = mock(host.post)
    host.post = post
    state.addSession("promoted", null)
    state.closeSession("promoted", null)

    await promoteLifecycleSession(ctx, host, "promoted")

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentManager.worktreeSetup",
        status: "ready",
        projectId: ctx.id,
        worktreeId: wt.id,
      }),
    )
    expect(host.notifyReady).not.toHaveBeenCalled()
    expect(calls).toContain("move:promoted")
    expect(calls).not.toContain("disk")
    expect(state.getWorktree(wt.id)).toBeDefined()
  })

  it("files a promoted session whose move has not settled, without admitting the handoff note", async () => {
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const wt = state.getWorktrees()[0]!
    host.createOnDisk = async () => ({ worktree: wt, result: { path: worktree, branch: wt.branch } }) as never
    state.addSession("promoted", null)
    // The server already runs the session in the worktree, but its drain did not end before the deadline.
    client.session.active.mockImplementation(async () => {
      setSystemTime(new Date(Date.now() + 60_000))
      return { promoted: { type: "running" } }
    })
    const synthetic = mock(async () => ({}))
    ;(client.session as unknown as { synthetic: typeof synthetic }).synthetic = synthetic

    try {
      await promoteLifecycleSession(ctx, host, "promoted")
    } finally {
      setSystemTime()
    }

    expect(state.getSession("promoted")?.worktreeId).toBe(wt.id)
    expect(synthetic).not.toHaveBeenCalled()
  })

  it("keeps the requested worktree for a session in a directory outside the project", async () => {
    const id = state.getWorktrees()[0]!.id
    client.session.get.mockResolvedValue({ id: "outside", location: { directory: path.join(os.tmpdir(), "elsewhere") } })

    await addSessionToLifecycleWorktree(ctx, host, id, "outside")

    expect(state.getSession("outside")?.worktreeId).toBe(id)
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
