import { afterAll, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WorktreeActivity, createWorktreeActivity } from "../src/agent-manager/worktree-activity"
import { samePath } from "../src/agent-manager/project/paths"

const WT = "/repo/worktrees/feature"
// The factory only loads worktree folders that exist on disk.
const HOME = mkdtempSync(path.join(tmpdir(), "kilo-activity-"))
const LIVE = path.join(HOME, "feature")
mkdirSync(LIVE)
afterAll(() => rmSync(HOME, { recursive: true, force: true }))

type Snapshot = {
  sessions?: string[]
  statuses: Record<string, { type: string }>
  permissions: Array<{ id: string; sessionID: string }>
  questions: Array<{ id: string; sessionID: string }>
}

function make(load: (dir: string) => Promise<Snapshot> = async () => ({ statuses: {}, permissions: [], questions: [] })) {
  const posts: string[][] = []
  const errors: unknown[] = []
  const activity = new WorktreeActivity({
    paths: () => [WT],
    load,
    post: (active) => posts.push(active),
    log: (err) => errors.push(err),
  })
  return { activity, posts, errors, load }
}

describe("WorktreeActivity", () => {
  it("marks a worktree active while a session is busy and clears it on idle", async () => {
    const { activity, posts } = make()

    await activity.sync()
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "session.idle", data: { sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([])
  })

  it("does not report a session blocked on a permission or form", async () => {
    const { activity, posts } = make()
    await activity.sync()

    activity.event({ type: "session.status", data: { sessionID: "s1", status: { type: "busy" } } }, WT)
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "permission.asked", data: { id: "p1", sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "permission.replied", data: { id: "p1", sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "form.created", data: { form: { id: "f1", sessionID: "s1" } } }, WT)
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "form.replied", data: { id: "f1", sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([WT])
  })

  it("loads statuses and pending requests from the directory", async () => {
    const load = mock(async (): Promise<Snapshot> => ({
      statuses: { s1: { type: "busy" } },
      permissions: [{ id: "p1", sessionID: "s2" }],
      questions: [],
    }))
    const { activity, posts } = make(load)
    await activity.sync(true)

    expect(load).toHaveBeenCalledWith(WT)
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "permission.asked", data: { id: "p2", sessionID: "s1" } }, WT)
    expect(posts.at(-1)).toEqual([])
  })

  it("clears a loaded busy session on a lifecycle event without a location", async () => {
    const { activity, posts } = make(async () => ({
      sessions: ["s1"],
      statuses: { s1: { type: "busy" } },
      permissions: [],
      questions: [],
    }))
    await activity.sync(true)
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "session.execution.succeeded", data: { sessionID: "s1" } })
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } })
    expect(posts.at(-1)).toEqual([WT])
  })

  it("keeps following a session after a failed run, and forgets it once deleted", async () => {
    const { activity, posts } = make(async () => ({
      sessions: ["s1"],
      statuses: { s1: { type: "busy" } },
      permissions: [],
      questions: [],
    }))
    await activity.sync(true)

    activity.event({ type: "session.execution.failed", data: { sessionID: "s1", error: {} } })
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } })
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "session.deleted", data: { sessionID: "s1" } })
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } })
    expect(posts.at(-1)).toEqual([])
  })

  it("follows a session created after the load through events without a location", async () => {
    const { activity, posts } = make()
    await activity.sync()

    activity.event({ type: "session.execution.started", data: { sessionID: "s2" } })
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.created", data: { sessionID: "s2", location: { directory: WT } } })
    activity.event({ type: "session.execution.started", data: { sessionID: "s2" } })
    expect(posts.at(-1)).toEqual([WT])

    activity.event({ type: "session.execution.interrupted", data: { sessionID: "s2", reason: "user" } })
    expect(posts.at(-1)).toEqual([])
  })

  it("reports nothing while a load fails, then retries", async () => {
    const load = mock(async (): Promise<Snapshot> => {
      throw new Error("backend unavailable")
    })
    const { activity, posts, errors } = make(load)
    await activity.sync()
    expect(posts.at(-1)).toEqual([])
    expect(errors).toHaveLength(1)

    load.mockResolvedValue({ statuses: { s1: { type: "retry" } }, permissions: [], questions: [] } as never)
    await activity.sync()
    expect(posts.at(-1)).toEqual([WT])
  })

  it("clears all activity on clear and stops publishing after dispose", async () => {
    const { activity, posts } = make()
    await activity.sync()
    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } }, WT)
    activity.clear()
    expect(posts.at(-1)).toEqual([])

    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } }, WT)
    activity.dispose()
    const count = posts.length
    activity.event({ type: "session.execution.started", data: { sessionID: "s1" } }, WT)
    expect(posts).toHaveLength(count)
  })

  it("leaves task sessions idle-like: only busy or retry statuses count", async () => {
    const { activity, posts } = make()
    await activity.sync()
    activity.event({ type: "session.status", data: { sessionID: "s1", status: { type: "idle" } } }, WT)
    expect(posts.at(-1)).toEqual([])
  })

  it("factory loads active sessions from the server and subscribes to events", async () => {
    const listener: { fn?: (event: unknown) => void } = {}
    const active: Record<string, { type: string }> = { s1: { type: "busy" }, other: { type: "busy" } }
    const connection = {
      client: async () => ({
        session: {
          list: async () => ({ data: [{ id: "s1" }, { id: "other" }] }),
          active: async () => active,
        },
        permission: { request: { list: async () => ({ data: [] }) } },
        form: { list: async () => ({ data: [] }) },
      }),
      state: () => "connected",
      onState: () => () => undefined,
      onEvent: (fn: (event: unknown) => void) => {
        listener.fn = fn
        return () => undefined
      },
    }
    const posts: string[][] = []
    const statuses: Array<[string, boolean]> = []
    const activity = createWorktreeActivity({
      connection: connection as never,
      paths: () => [LIVE],
      post: (active) => posts.push(active),
      status: (id, running) => statuses.push([id, running]),
      log: () => {},
    })

    await activity.sync()
    expect(posts.at(-1)?.map((dir) => (samePath(dir, LIVE) ? dir : undefined))).toEqual([LIVE])

    listener.fn?.({ type: "session.idle", data: { sessionID: "s1" }, location: { directory: LIVE } })
    expect(statuses).toContainEqual(["s1", false])
    activity.dispose()
  })

  it("follows the connection: pause while connecting, clear when it drops, reload when it returns", async () => {
    const stateListener: { fn?: (state: "connecting" | "connected" | "disconnected") => void } = {}
    let current: "connecting" | "connected" | "disconnected" = "connected"
    let loads = 0
    const connection = {
      client: async () => {
        loads++
        return {
          session: { list: async () => ({ data: [] }), active: async () => ({}) },
          permission: { request: { list: async () => ({ data: [] }) } },
          form: { list: async () => ({ data: [] }) },
        }
      },
      state: () => current,
      onState: (fn: (state: "connecting" | "connected" | "disconnected") => void) => {
        stateListener.fn = fn
        return () => undefined
      },
      onEvent: () => () => undefined,
    }
    const posts: string[][] = []
    const activity = createWorktreeActivity({
      connection: connection as never,
      paths: () => [LIVE],
      post: (active) => posts.push(active),
      status: () => {},
      log: () => {},
    })

    await activity.sync()
    expect(loads).toBe(1)

    // A dropped connection loads nothing and clears the badges it had.
    current = "disconnected"
    await activity.sync()
    stateListener.fn?.("disconnected")
    expect(loads).toBe(1)
    expect(posts.at(-1)).toEqual([])

    // A returned connection reloads every directory instead of keeping the stale badges.
    current = "connecting"
    stateListener.fn?.("connecting")
    current = "connected"
    stateListener.fn?.("connected")
    const deadline = Date.now() + 1000
    while (loads < 2 && Date.now() < deadline) await Bun.sleep(5)
    expect(loads).toBe(2)
    activity.dispose()
  })

  it("does not load a worktree folder deleted on disk until it is restored", async () => {
    const gone = path.join(HOME, "deleted")
    const loaded: string[] = []
    const errors: unknown[] = []
    const connection = {
      client: async () => ({
        session: {
          list: async (input: { directory: string }) => {
            loaded.push(input.directory)
            // The server answers a missing folder with LocationNotFoundError.
            if (!existsSync(input.directory)) throw new Error(`Location not found: ${input.directory}`)
            return { data: [] }
          },
          active: async () => ({}),
        },
        permission: { request: { list: async () => ({ data: [] }) } },
        form: { list: async () => ({ data: [] }) },
      }),
      state: () => "connected",
      onState: () => () => undefined,
      onEvent: () => () => undefined,
    }
    const activity = createWorktreeActivity({
      connection: connection as never,
      paths: () => [LIVE, gone],
      post: () => {},
      status: () => {},
      log: (err) => errors.push(err),
    })

    // Every state push syncs; a missing folder used to fail and log on each of them.
    await activity.sync()
    await activity.sync()
    await activity.sync()
    expect(loaded).toEqual([LIVE])
    expect(errors).toEqual([])

    mkdirSync(gone)
    await activity.sync()
    expect(loaded).toEqual([LIVE, gone])
    activity.dispose()
  })

  it("reports session status accurately using runningFromEvent instead of marking idle session.status as running", () => {
    const listener: { fn?: (event: unknown) => void } = {}
    const connection = {
      client: async () => ({
        session: { list: async () => ({ data: [] }), active: async () => ({}) },
        permission: { request: { list: async () => ({ data: [] }) } },
        form: { list: async () => ({ data: [] }) },
      }),
      state: () => "connected",
      onState: () => () => undefined,
      onEvent: (fn: (event: unknown) => void) => {
        listener.fn = fn
        return () => undefined
      },
    }
    const statuses: Array<[string, boolean]> = []
    const activity = createWorktreeActivity({
      connection: connection as never,
      paths: () => [LIVE],
      post: () => {},
      status: (id, running) => statuses.push([id, running]),
      log: () => {},
    })

    listener.fn?.({ type: "session.status", data: { sessionID: "s1", status: { type: "busy" } } })
    listener.fn?.({ type: "session.status", data: { sessionID: "s1", status: { type: "idle" } } })
    listener.fn?.({ type: "session.status", data: { sessionID: "s2", status: { type: "retry" } } })
    listener.fn?.({ type: "session.status", data: { sessionID: "s2" } })
    listener.fn?.({ type: "session.retry.scheduled", data: { sessionID: "s3" } })
    listener.fn?.({ type: "session.deleted", data: { sessionID: "s3" } })
    listener.fn?.({ type: "session.created", data: { sessionID: "s4" } })

    expect(statuses).toEqual([
      ["s1", true],
      ["s1", false],
      ["s2", true],
      ["s2", false],
      ["s3", true],
      ["s3", false],
    ])
    activity.dispose()
  })
})
