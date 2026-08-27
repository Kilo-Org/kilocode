import { describe, expect, it } from "bun:test"
import { createWorktreeActivity, WorktreeActivity } from "../../src/agent-manager/worktree-activity"

type Snapshot = {
  statuses: Record<string, { type: string }>
  permissions: Array<{ id: string; sessionID: string }>
  questions: Array<{ id: string; sessionID: string; blocking?: boolean }>
}

function defer<T>() {
  return Promise.withResolvers<T>()
}

function snapshot(
  statuses: Record<string, string> = {},
  permissions: string[][] = [],
  questions: string[][] = [],
): Snapshot {
  return {
    statuses: Object.fromEntries(Object.entries(statuses).map(([id, type]) => [id, { type }])),
    permissions: permissions.map(([id, sessionID]) => ({ id, sessionID })),
    questions: questions.map(([id, sessionID]) => ({ id, sessionID })),
  }
}

function status(sessionID: string, type: string) {
  return { type: "session.status", properties: { sessionID, status: { type } } }
}

function asked(type: "permission" | "question", id: string, sessionID: string) {
  return { type: `${type}.asked`, properties: { id, sessionID } }
}

function replied(type: "permission" | "question", requestID: string, sessionID: string, kind = "replied") {
  return { type: `${type}.${kind}`, properties: { requestID, sessionID } }
}

function setup(dirs: string[], load: (dir: string) => Promise<Snapshot>) {
  const posted: string[][] = []
  const errors: unknown[] = []
  const activity = new WorktreeActivity({
    paths: () => dirs,
    load,
    post: (active) => posted.push(active),
    log: (err) => errors.push(err),
  })
  return { activity, posted, errors }
}

function connection(client: unknown, state = "connected") {
  let stateListener: ((value: string) => void) | undefined
  let eventListener: ((event: unknown, directory?: string) => void) | undefined
  let eventFilter: ((event: unknown) => boolean) | undefined
  const value = {
    getClient: () => client,
    getConnectionState: () => state,
    onStateChange: (listener: (value: string) => void) => {
      stateListener = listener
      return () => {
        stateListener = undefined
      }
    },
    onEventFiltered: (filter: (event: unknown) => boolean, listener: (event: unknown, directory?: string) => void) => {
      eventFilter = filter
      eventListener = listener
      return () => {
        eventFilter = undefined
        eventListener = undefined
      }
    },
    change: (next: string) => {
      state = next
      stateListener?.(next)
    },
    set: (next: string) => {
      state = next
    },
    emit: (event: unknown, directory?: string) => {
      if (eventFilter?.(event)) eventListener?.(event, directory)
    },
  }
  return value
}

describe("WorktreeActivity", () => {
  it("accepts only relevant SDK events", () => {
    expect(WorktreeActivity.accepts({ type: "session.status" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "session.deleted" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "session.error" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "permission.asked" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "permission.replied" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "question.asked" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "question.replied" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "question.rejected" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "server.instance.disposed" })).toBe(true)
    expect(WorktreeActivity.accepts({ type: "session.created" })).toBe(false)
    expect(WorktreeActivity.accepts(null)).toBe(false)
    expect(WorktreeActivity.accepts("session.status")).toBe(false)
  })

  it("counts busy and retry children while ignoring idle and offline sessions", async () => {
    const test = setup(["/repo"], async () => snapshot({ parent: "idle", child: "busy" }))
    await test.activity.sync()
    expect(test.posted.at(-1)).toEqual(["/repo"])

    test.activity.event(status("child", "idle"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
    test.activity.event(status("parent", "retry"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(status("parent", "offline"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
  })

  it("excludes blocked children without suppressing active siblings", async () => {
    const test = setup(["/repo"], async () => snapshot({ child: "busy", sibling: "idle" }))
    await test.activity.sync()

    test.activity.event(asked("permission", "p1", "child"), "/repo")
    test.activity.event(asked("permission", "p2", "child"), "/repo")
    test.activity.event(asked("question", "q1", "child"), "/repo")
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(status("sibling", "busy"), "/repo")
    test.activity.event(replied("permission", "p1", "child"), "/repo")
    test.activity.event(replied("question", "q1", "child"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])

    test.activity.event(replied("permission", "p2", "child"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(status("sibling", "idle"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(status("child", "idle"), "/repo")
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(asked("question", "q2", "child"), "/repo")
    test.activity.event(replied("question", "q2", "child", "rejected"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
  })

  it("ignores non-blocking questions in snapshots and live events", async () => {
    const test = setup(["/repo"], async () => ({
      ...snapshot({ child: "busy" }),
      questions: [{ id: "note", sessionID: "child", blocking: false }],
    }))
    await test.activity.sync()
    expect(test.posted.at(-1)).toEqual(["/repo"])

    const question = asked("question", "live", "child")
    test.activity.event({ ...question, properties: { ...question.properties, blocking: false } }, "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(question, "/repo")
    expect(test.posted.at(-1)).toEqual([])
    test.activity.event({ ...question, properties: { ...question.properties, blocking: false } }, "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
  })

  it("clears sessions on completion, deletion, errors, and offline status", async () => {
    const test = setup(["/repo"], async () => snapshot())
    await test.activity.sync()
    test.activity.event(status("s1", "busy"), "/repo")
    test.activity.event(status("s1", "complete"), "/repo")
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(status("s1", "busy"), "/repo")
    test.activity.event({ type: "session.error", properties: { sessionID: "s1" } }, "/repo")
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(status("s1", "busy"), "/repo")
    test.activity.event({ type: "session.deleted", properties: { info: { id: "s1" } } }, "/repo")
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(status("s1", "busy"), "/repo")
    test.activity.event(status("s1", "offline"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
  })

  it("isolates normalized directories and ignores unknown ownership", async () => {
    const dirs = ["/repo/a/", "/repo/b"]
    const test = setup(dirs, async () => snapshot())
    await test.activity.sync()

    test.activity.event(status("a1", "busy"), "\\repo\\a\\")
    expect(test.posted.at(-1)).toEqual(["/repo/a/"])
    test.activity.event(status("b1", "busy"), "/repo/b/")
    expect(test.posted.at(-1)).toEqual(["/repo/a/", "/repo/b"])
    test.activity.event(status("unknown", "busy"), "/repo/unknown")
    expect(test.posted.at(-1)).toEqual(["/repo/a/", "/repo/b"])
  })

  it("deduplicates loads, hydrates new paths, force refreshes, and replays cached output", async () => {
    const dirs = ["/repo"]
    const firstGate = defer<Snapshot>()
    const forceGate = defer<Snapshot>()
    const newGate = defer<Snapshot>()
    const gates = [firstGate, forceGate, newGate]
    const calls: string[] = []
    const test = setup(dirs, (dir) => {
      calls.push(dir)
      const gate = gates.shift()
      if (!gate) return Promise.resolve(snapshot())
      return gate.promise
    })

    const first = test.activity.sync()
    const second = test.activity.sync()
    await Bun.sleep(0)
    expect(calls).toEqual(["/repo"])
    test.activity.event(status("s1", "busy"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])
    firstGate.resolve(snapshot({ s1: "busy" }))
    await Promise.all([first, second])
    expect(calls).toEqual(["/repo"])

    test.activity.replay()
    expect(test.posted.at(-1)).toEqual(["/repo"])
    const force = test.activity.sync(true)
    await Bun.sleep(0)
    expect(calls).toEqual(["/repo", "/repo"])
    forceGate.resolve(snapshot())
    await force
    expect(test.posted.at(-1)).toEqual([])

    dirs.push("/repo/new")
    const add = test.activity.sync()
    await Bun.sleep(0)
    expect(calls).toEqual(["/repo", "/repo", "/repo/new"])
    newGate.resolve(snapshot({ newSession: "retry" }))
    await add
    expect(test.posted.at(-1)).toEqual(["/repo/new"])
  })

  it("defers the loader and recovers from synchronous failures", async () => {
    const error = new Error("load failed")
    let calls = 0
    const test = setup(["/repo"], () => {
      calls += 1
      if (calls === 1) throw error
      return Promise.resolve(snapshot({ child: "busy" }))
    })
    const pending = test.activity.sync()
    expect(calls).toBe(0)
    await pending
    expect(test.errors).toEqual([error])

    await test.activity.sync()
    expect(calls).toBe(2)
    expect(test.posted.at(-1)).toEqual(["/repo"])
    await test.activity.sync()
    expect(calls).toBe(2)
  })

  it("commits snapshots to the tracked state used by later events and refreshes", async () => {
    const initial = snapshot({ child: "busy" }, [["p1", "child"]], [["q1", "child"]])
    const snapshots = [initial, snapshot({ child: "retry" })]
    const test = setup(["/repo"], async () => snapshots.shift()!)
    await test.activity.sync()
    expect(test.posted.at(-1)).toEqual([])

    test.activity.event(replied("permission", "p1", "child"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
    test.activity.event(replied("question", "q1", "child"), "/repo")
    expect(test.posted.at(-1)).toEqual(["/repo"])

    await test.activity.sync(true)
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(status("child", "idle"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
    expect(initial).toEqual(snapshot({ child: "busy" }, [["p1", "child"]], [["q1", "child"]]))
    expect(test.errors).toEqual([])
  })

  it("does not let a snapshot overwrite newer events or remove other active children", async () => {
    const gate = defer<Snapshot>()
    const test = setup(["/repo"], () => gate.promise)
    const pending = test.activity.sync()
    test.activity.event(status("one", "idle"), "/repo")
    test.activity.event(status("two", "idle"), "/repo")
    test.activity.event(status("one", "busy"), "/repo")
    test.activity.event(status("two", "busy"), "/repo")
    test.activity.event(status("one", "idle"), "/repo")
    gate.resolve(snapshot({ one: "busy", two: "busy" }))
    await pending
    expect(test.posted.at(-1)).toEqual(["/repo"])
    test.activity.event(status("two", "idle"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
  })

  it("prunes removed paths and prevents old loads from reviving activity", async () => {
    const dirs = ["/repo"]
    const gate = defer<Snapshot>()
    const test = setup(dirs, () => gate.promise)
    const pending = test.activity.sync()
    test.activity.event(status("s1", "busy"), "/repo")
    dirs.length = 0
    await test.activity.sync()
    expect(test.posted.at(-1)).toEqual([])
    test.activity.event(status("s1", "busy"), "/repo")
    expect(test.posted.at(-1)).toEqual([])
    gate.resolve(snapshot({ s1: "busy" }))
    await pending
    expect(test.posted.at(-1)).toEqual([])
  })

  it("clears on disconnect and disposal, then allows a fresh sync", async () => {
    const dirs = ["/repo"]
    const firstGate = defer<Snapshot>()
    const nextGate = defer<Snapshot>()
    const gates = [firstGate, nextGate]
    const test = setup(dirs, () => gates.shift()!.promise)
    const first = test.activity.sync()
    test.activity.event(status("s1", "busy"), "/repo")
    test.activity.event({ type: "server.instance.disposed", properties: { directory: "/repo" } }, "/repo")
    expect(test.posted.at(-1)).toEqual([])
    firstGate.resolve(snapshot({ s1: "busy" }))
    await first
    expect(test.posted.at(-1)).toEqual([])

    test.activity.clear()
    expect(test.posted.at(-1)).toEqual([])
    const next = test.activity.sync()
    nextGate.resolve(snapshot({ s2: "busy" }))
    await next
    expect(test.posted.at(-1)).toEqual(["/repo"])

    test.activity.dispose()
    const count = test.posted.length
    test.activity.event(status("s3", "busy"), "/repo")
    await test.activity.sync()
    test.activity.replay()
    expect(test.posted).toHaveLength(count)
  })

  it("logs failed paths without erasing successful siblings and retries them", async () => {
    const dirs = ["/repo/a", "/repo/b"]
    const a = defer<Snapshot>()
    const b = defer<Snapshot>()
    const retry = defer<Snapshot>()
    const calls: string[] = []
    const test = setup(dirs, (dir) => {
      calls.push(dir)
      if (dir === "/repo/a") return a.promise
      if (calls.filter((item) => item === "/repo/b").length === 1) return b.promise
      return retry.promise
    })
    const pending = test.activity.sync()
    a.resolve(snapshot({ a1: "busy" }))
    b.reject(new Error("b failed"))
    await pending
    expect(test.errors).toHaveLength(1)
    expect(test.posted.at(-1)).toEqual(["/repo/a"])
    expect(calls).toEqual(["/repo/a", "/repo/b"])

    const again = test.activity.sync()
    await Bun.sleep(0)
    expect(calls).toEqual(["/repo/a", "/repo/b", "/repo/b"])
    retry.resolve(snapshot())
    await again
    expect(test.posted.at(-1)).toEqual(["/repo/a"])
  })

  it("does not replay failed-load events over a newer recovery snapshot", async () => {
    const first = defer<Snapshot>()
    const next = defer<Snapshot>()
    const gates = [first, next]
    const test = setup(["/repo"], () => gates.shift()!.promise)
    const pending = test.activity.sync()
    test.activity.event(status("child", "busy"), "/repo")
    first.reject(new Error("snapshot failed"))
    await pending
    expect(test.posted.at(-1)).toEqual(["/repo"])

    const recovery = test.activity.sync(true)
    next.resolve(snapshot())
    await recovery
    expect(test.posted.at(-1)).toEqual([])
  })

  it("publishes a ready worktree while another snapshot is still loading", async () => {
    const gate = defer<Snapshot>()
    const ready = defer<string[]>()
    const activity = new WorktreeActivity({
      paths: () => ["/fast", "/slow"],
      load: async (dir) => (dir === "/fast" ? snapshot({ child: "busy" }) : gate.promise),
      post: (active) => ready.resolve(active),
      log: (err) => {
        throw err
      },
    })
    const pending = activity.sync()
    expect(await ready.promise).toEqual(["/fast"])
    gate.resolve(snapshot())
    await pending
    activity.dispose()
  })

  it("wires the activity wrapper to the connection without loading histories", async () => {
    const calls: string[] = []
    const client = {
      session: {
        status: async (input: { directory: string }, options: { throwOnError: true }) => {
          calls.push(`status:${input.directory}:${options.throwOnError}`)
          return { data: { s1: { type: "busy" } } }
        },
      },
      permission: {
        list: async (input: { directory: string }, options: { throwOnError: true }) => {
          calls.push(`permission:${input.directory}:${options.throwOnError}`)
          return { data: [] }
        },
      },
      question: {
        list: async (input: { directory: string }, options: { throwOnError: true }) => {
          calls.push(`question:${input.directory}:${options.throwOnError}`)
          return { data: [] }
        },
      },
    }
    const conn = connection(client)
    const posted: string[][] = []
    const statuses: unknown[] = []
    const lifecycle: unknown[] = []
    const wrapper = createWorktreeActivity({
      connection: conn as never,
      paths: () => ["/repo"],
      post: (active) => posted.push(active),
      status: (event) => statuses.push(event),
      lifecycle: (event) => lifecycle.push(event),
      log: () => {},
    })

    await wrapper.sync()
    expect(calls).toEqual(["status:/repo:true", "permission:/repo:true", "question:/repo:true"])
    expect(posted.at(-1)).toEqual(["/repo"])
    expect(conn.emit({ type: "session.created", properties: {} }, "/repo")).toBeUndefined()
    expect(conn.emit(status("s1", "idle"), "/repo")).toBeUndefined()
    expect(statuses).toHaveLength(1)
    expect(lifecycle).toHaveLength(1)
    expect(posted.at(-1)).toEqual([])

    conn.change("disconnected")
    expect(posted.at(-1)).toEqual([])
    await wrapper.sync()
    expect(calls).toHaveLength(3)

    conn.change("connected")
    await Bun.sleep(0)
    expect(calls).toHaveLength(6)
    wrapper.dispose()
    conn.emit(status("s1", "busy"), "/repo")
    expect(statuses).toHaveLength(1)
  })

  it("replays before a forced sync checks connection state", async () => {
    const client = {
      session: { status: async () => ({ data: { s1: { type: "busy" } } }) },
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
    }
    const conn = connection(client)
    const posted: string[][] = []
    const wrapper = createWorktreeActivity({
      connection: conn as never,
      paths: () => ["/repo"],
      post: (active) => posted.push(active),
      status: () => {},
      lifecycle: () => {},
      log: () => {},
    })
    await wrapper.sync()
    conn.set("disconnected")
    posted.length = 0
    await wrapper.sync(true)
    expect(posted).toEqual([["/repo"]])
    wrapper.dispose()
  })
})
