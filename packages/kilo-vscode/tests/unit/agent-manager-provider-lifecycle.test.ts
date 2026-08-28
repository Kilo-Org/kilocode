import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { deleteLifecycleWorktree, type LifecycleHost } from "../../src/agent-manager/provider-lifecycle"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

describe("Agent Manager worktree deletion lifecycle", () => {
  let root: string
  let worktree: string
  let state: WorktreeStateManager
  let ctx: ProjectContext
  let calls: string[]
  let routes: Array<{ sessionID: string; directory: string; projectID: string; generation: number }>
  let client: {
    session: { status: ReturnType<typeof mock>; delete: ReturnType<typeof mock> }
    permission: { list: ReturnType<typeof mock> }
    question: { list: ReturnType<typeof mock> }
    experimental: { session: { list: ReturnType<typeof mock> }; controlPlane: { moveSession: ReturnType<typeof mock> } }
    kilocode: { removeSnapshot: ReturnType<typeof mock> }
  }
  let host: LifecycleHost

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-delete-lifecycle-"))
    worktree = path.join(root, "worktree")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(worktree)
    calls = []
    routes = []
    state = new WorktreeStateManager(root, () => undefined)
    ctx = new ProjectContext("project", root, true, {
      log: () => undefined,
      state: () => state,
      worktrees: () =>
        ({
          removeWorktree: mock(async () => calls.push("disk")),
        }) as never,
    })
    ctx.stateManager().addWorktree({ branch: "feature", path: worktree, parentBranch: "main" })
    client = {
      session: {
        status: mock(async () => ({ data: {} as Record<string, SessionStatus> })),
        delete: mock(async () => ({ data: true })),
      },
      permission: { list: mock(async () => ({ data: [] })) },
      question: { list: mock(async () => ({ data: [] })) },
      experimental: {
        session: {
          list: mock(async () => ({
            data: state.getSessions().map((session) => ({ id: session.id, directory: worktree })),
          })),
        },
        controlPlane: {
          moveSession: mock(async ({ sessionID }: { sessionID: string }) => {
            calls.push(`move:${sessionID}`)
          }),
        },
      },
      kilocode: {
        removeSnapshot: mock(async () => {
          calls.push("snapshots")
          return { data: true }
        }),
      },
    }
    host = {
      createOnDisk: async () => null,
      runSetup: async () => undefined,
      createSession: async () => null,
      notifyReady: () => undefined,
      sessions: {
        register: () => undefined,
        clearDirectory: (id) => calls.push(`clear:${id}`),
        setSessionDirectory: (id, directory) => calls.push(`directory:${id}:${directory}`),
        registerSessionRoute: (ref, directory, generation) =>
          routes.push({ sessionID: ref.sessionId, projectID: ref.projectId, directory, generation }),
        directories: () => new Map(),
        abort: async () => undefined,
        forget: () => undefined,
      },
      push: () => calls.push("push"),
      register: () => undefined,
      skipStats: () => calls.push("stats:skip"),
      unskipStats: () => calls.push("stats:unskip"),
      removePR: () => calls.push("pr"),
      removeRun: async () => calls.push("run:remove"),
      clearRun: async () => {
        calls.push("run:clear")
        return true
      },
      forgetName: () => calls.push("name"),
      stopDiffs: () => calls.push("diff"),
      capture: () => undefined,
      autoName: () => ({ enabled: false }),
      client: () => client as unknown as KiloClient,
      acquirePtyCleanup: async () => {
        calls.push("pty")
        return () => calls.push("pty:release")
      },
      metadata: async () => ({}),
      post: (message) => calls.push(`post:${message.type}`),
      notify: (message) => calls.push(`notify:${message}`),
      log: () => undefined,
    }
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const deleteWorktree = async () => deleteLifecycleWorktree(ctx, host, state.getWorktrees()[0]!.id)

  it.each([
    ["busy", { type: "busy" }],
    ["retry", { type: "retry", attempt: 1, message: "retry", next: 100 }],
    ["offline", { type: "offline", requestID: "req", message: "offline" }],
  ] as const)("refuses a %s session before cleanup", async (_name, status) => {
    const session = state.addSession("session", state.getWorktrees()[0]!.id)
    client.session.status.mockResolvedValue({ data: { [session.id]: status } })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(session.worktreeId!)).toBeDefined()
    expect(client.session.status).toHaveBeenCalledWith({ directory: worktree }, { throwOnError: true })
    expect(client.permission.list).toHaveBeenCalledWith({ directory: worktree }, { throwOnError: true })
    expect(client.question.list).toHaveBeenCalledWith({ directory: worktree }, { throwOnError: true })
  })

  it.each(["permission", "question"] as const)("refuses a pending %s before cleanup", async (kind) => {
    const session = state.addSession("session", state.getWorktrees()[0]!.id)
    const list = kind === "permission" ? client.permission.list : client.question.list
    list.mockResolvedValue({ data: [{ id: kind, sessionID: session.id }] })

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktree(session.worktreeId!)).toBeDefined()
  })

  it("fails closed before cleanup when an authoritative check fails", async () => {
    client.question.list.mockRejectedValue(new Error("backend unavailable"))

    await deleteWorktree()

    expect(calls).toEqual(["post:error"])
    expect(state.getWorktrees()).toHaveLength(1)
  })

  it.each(["removeRun", "clearRun", "acquirePtyCleanup"] as const)(
    "reports a %s failure without removing the worktree or checkpoints",
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
      expect(client.kilocode.removeSnapshot).not.toHaveBeenCalled()
      expect(state.getWorktrees()).toHaveLength(1)
    },
  )

  it("reports checkpoint cleanup failures while preserving and retargeting sessions", async () => {
    const session = state.addSession("retained", state.getWorktrees()[0]!.id)
    const notify = mock(host.notify)
    host.notify = notify
    client.kilocode.removeSnapshot.mockRejectedValue(new Error("checkpoint cleanup failed"))

    await deleteWorktree()

    expect(notify).toHaveBeenCalledWith(
      "The worktree was deleted, but its checkpoint data could not be removed. Conversation history is preserved.",
    )
    expect(state.getWorktrees()).toHaveLength(0)
    expect(routes).toContainEqual({
      sessionID: session.id,
      projectID: ctx.id,
      directory: ctx.root,
      generation: ctx.generation,
    })
    expect(client.session.delete).not.toHaveBeenCalled()
  })

  it("relocates archived and child sessions not present in Agent Manager state", async () => {
    client.experimental.session.list.mockResolvedValue({
      data: [
        { id: "archived", directory: worktree, time: { archived: 1 } },
        { id: "child", directory: worktree, parentID: "parent" },
      ],
    })

    await deleteWorktree()

    expect(routes.map((route) => route.sessionID)).toEqual(["archived", "child"])
    expect(client.experimental.controlPlane.moveSession).toHaveBeenCalledTimes(2)
    expect(client.session.delete).not.toHaveBeenCalled()
  })

  it("does not discard checkpoints when persistent session relocation fails", async () => {
    state.addSession("retained", state.getWorktrees()[0]!.id)
    client.experimental.controlPlane.moveSession.mockRejectedValue(new Error("move failed"))

    await deleteWorktree()

    expect(calls).toContain("disk")
    expect(calls).toContain("post:error")
    expect(client.kilocode.removeSnapshot).not.toHaveBeenCalled()
    expect(state.getWorktrees()).toHaveLength(1)
    expect(client.session.delete).not.toHaveBeenCalled()
  })

  it("retargets orphaned sessions to the exact project root without deleting them", async () => {
    const first = state.addSession("first", state.getWorktrees()[0]!.id)
    const second = state.addSession("second", state.getWorktrees()[0]!.id)

    await deleteWorktree()

    expect(routes).toEqual([
      { sessionID: first.id, projectID: ctx.id, directory: ctx.root, generation: ctx.generation },
      { sessionID: second.id, projectID: ctx.id, directory: ctx.root, generation: ctx.generation },
    ])
    expect(calls).not.toContain(`clear:${first.id}`)
    expect(calls).not.toContain(`clear:${second.id}`)
    expect(client.session.delete).not.toHaveBeenCalled()
    expect(client.experimental.session.list).toHaveBeenCalledWith(
      { directory: worktree, archived: true, roots: false, limit: Number.MAX_SAFE_INTEGER },
      { throwOnError: true },
    )
    for (const session of [first, second]) {
      expect(client.experimental.controlPlane.moveSession).toHaveBeenCalledWith(
        { sessionID: session.id, destination: { directory: ctx.root }, moveChanges: false },
        { throwOnError: true },
      )
      expect(calls.indexOf(`move:${session.id}`)).toBeGreaterThan(calls.indexOf("disk"))
      expect(calls.indexOf(`move:${session.id}`)).toBeLessThan(calls.indexOf("snapshots"))
    }
    expect(client.kilocode.removeSnapshot).toHaveBeenCalledWith(
      { directory: ctx.root, worktree },
      { throwOnError: true },
    )
    expect(state.getWorktrees()).toHaveLength(0)
    expect(state.getSessions()).toHaveLength(0)
  })
})
