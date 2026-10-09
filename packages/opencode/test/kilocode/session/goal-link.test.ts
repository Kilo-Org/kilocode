import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Exit } from "effect"
import { SessionID } from "@/session/schema"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalPolicy } from "@/kilocode/session/goal/policy"
import { GoalState } from "@/kilocode/session/goal/state"

const part = (tool: string, state: unknown) =>
  ({ type: "tool", tool, state }) as unknown as typeof SessionV1.ToolPart.Type
const completed = (metadata: Record<string, unknown>) => ({ status: "completed", metadata })
const sid = (name: string) => SessionID.make(`ses_link_${name}_${crypto.randomUUID()}`)

describe("GoalLink.waitFor", () => {
  test("classifies a completed schedule_wakeup", () => {
    expect(
      GoalLink.waitFor(part("schedule_wakeup", completed({ id: "wku_1", prompt: "check the deploy", dueAt: 1_000 }))),
    ).toEqual({ kind: "wakeup", id: "wku_1", label: "check the deploy", dueAt: 1_000 })
  })

  test("falls back to reason then id for a wakeup label", () => {
    expect(GoalLink.waitFor(part("schedule_wakeup", completed({ id: "wku_2", reason: "deploy" })))).toMatchObject({
      label: "deploy",
    })
    expect(GoalLink.waitFor(part("schedule_wakeup", completed({ id: "wku_2" })))).toMatchObject({ label: "wku_2" })
  })

  test("does not record a capped wakeup without an id", () => {
    expect(GoalLink.waitFor(part("schedule_wakeup", completed({})))).toBeUndefined()
  })

  test("classifies a completed cron_create", () => {
    expect(
      GoalLink.waitFor(part("cron_create", completed({ id: "wku_3", prompt: "poll", dueAt: 2_000, recurring: true }))),
    ).toEqual({ kind: "cron", id: "wku_3", label: "poll", dueAt: 2_000, recurring: true })
    expect(GoalLink.waitFor(part("cron_create", completed({ id: "wku_4", prompt: "once" })))).toMatchObject({
      recurring: false,
    })
    expect(GoalLink.waitFor(part("cron_create", completed({ prompt: "no id" })))).toBeUndefined()
  })

  test("classifies a running background_process and ignores terminal ones", () => {
    expect(GoalLink.waitFor(part("background_process", completed({ processID: "bgp_1", status: "running" })))).toEqual({
      kind: "process",
      id: "bgp_1",
      label: "bgp_1",
    })
    for (const status of ["exited", "failed", "stopped", "stopping"]) {
      expect(GoalLink.waitFor(part("background_process", completed({ processID: "bgp_1", status })))).toBeUndefined()
    }
    expect(GoalLink.waitFor(part("background_process", completed({ status: "running" })))).toBeUndefined()
  })

  test("ignores non-scheduling and unfinished parts", () => {
    expect(GoalLink.waitFor(part("bash", completed({ exit: 0 })))).toBeUndefined()
    expect(GoalLink.waitFor(part("cancel_wakeup", completed({ id: "wku_5" })))).toBeUndefined()
    expect(GoalLink.waitFor(part("schedule_wakeup", { status: "running", metadata: { id: "wku_6" } }))).toBeUndefined()
    expect(GoalLink.waitFor(part("schedule_wakeup", { status: "pending" }))).toBeUndefined()
  })
})

describe("GoalLink.bookkeeping", () => {
  test("names the inspect and cancel calls", () => {
    for (const tool of ["cancel_wakeup", "cron_list", "cron_delete"]) expect(GoalLink.bookkeeping(tool)).toBe(true)
    for (const tool of ["schedule_wakeup", "cron_create", "background_process", "bash"])
      expect(GoalLink.bookkeeping(tool)).toBe(false)
  })
})

describe("GoalLink record", () => {
  test("set, get, take and clear", () => {
    const id = sid("record")
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_9", label: "later" }
    GoalLink.set(id, wait)
    expect(GoalLink.get(id)).toEqual(wait)
    expect(GoalLink.take(id, "wku_other")).toBeUndefined()
    expect(GoalLink.get(id)).toEqual(wait)
    expect(GoalLink.take(id, "wku_9")).toEqual(wait)
    expect(GoalLink.get(id)).toBeUndefined()
    GoalLink.set(id, wait)
    GoalLink.clear(id)
    expect(GoalLink.get(id)).toBeUndefined()
  })
})

describe("GoalLink.resumeOrQueue", () => {
  test("arms an idle session", async () => {
    const id = sid("arm")
    const calls: string[] = []
    GoalLink.registerArm(id, (input) =>
      Effect.sync(() => {
        calls.push(input.note ?? "")
      }),
    )
    await Effect.runPromise(GoalLink.resumeOrQueue(id, "go", { kind: "wakeup", id: "wku_arm", label: "x" }))
    expect(calls).toEqual(["go"])
  })

  test("queues when the goal loop holds a token", async () => {
    const id = sid("queue")
    let armed = 0
    GoalLink.registerArm(id, () =>
      Effect.sync(() => {
        armed++
      }),
    )
    GoalState.start(id)
    const wait: GoalLink.Wait = { kind: "cron", id: "wku_q", label: "x" }
    await Effect.runPromise(GoalLink.resumeOrQueue(id, "go", wait))
    expect(armed).toBe(0)
    expect(GoalLink.takePending(id)).toEqual([{ note: "go", wait }])
    expect(GoalState.active(id)).toBe(true)
    GoalState.pause(id)
    expect(GoalState.active(id)).toBe(false)
  })

  test("clear drops queued fires so a later goal does not inherit them", async () => {
    const id = sid("clear-pending")
    GoalState.start(id)
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_p", label: "x" }
    await Effect.runPromise(GoalLink.resumeOrQueue(id, "go", wait))
    GoalLink.clear(id)
    expect(GoalLink.takePending(id)).toEqual([])
    GoalState.pause(id)
  })

  test("fails when no goal resume handler is registered", async () => {
    const id = sid("nohandler")
    const exit = await Effect.runPromiseExit(GoalLink.arm(id, { sessionID: id, action: "resume" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("arm uses the bound instance factory when no per-session handler exists", async () => {
    const id = sid("bind")
    const dir = `/tmp/goal-link-bind-${id}`
    const calls: string[] = []
    GoalLink.bind(dir, (input) =>
      Effect.sync(() => {
        calls.push(input.note ?? "")
      }),
    )
    await Effect.runPromise(GoalLink.arm(id, { sessionID: id, action: "resume", note: "go" }, dir))
    expect(calls).toEqual(["go"])
  })
})

describe("GoalLink.hydrate", () => {
  test("restores a waiting goal's wait record and hold", () => {
    const id = sid("hydrate")
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_h", label: "later", dueAt: 5 }
    expect(GoalLink.hydrate(id, { "kilo.goal": { text: "obj", status: "waiting", wait } })).toEqual(wait)
    expect(GoalLink.get(id)).toEqual(wait)
    expect(GoalState.waiting(id)).toBe(true)
    expect(GoalState.hold(id)).toBe(true)
    expect(GoalPolicy.available(id, "question")).toBe(false)
  })

  test("ignores a goal that is not waiting", () => {
    const id = sid("hydrate-skip")
    expect(GoalLink.hydrate(id, { "kilo.goal": { text: "obj", status: "active" } })).toBeUndefined()
    expect(GoalLink.get(id)).toBeUndefined()
    expect(GoalState.hold(id)).toBe(false)
  })
})

describe("GoalLink.claim", () => {
  test("an in-flight goal owns a fire even before the wait is persisted", () => {
    const id = sid("claim-inflight")
    GoalState.start(id)
    const info = { id: "wku_fire", prompt: "fired note", dueAt: 1 }
    expect(GoalLink.claim(id, info, "wakeup", { "kilo.goal": { text: "obj", status: "active" } })).toEqual({
      kind: "wakeup",
      id: "wku_fire",
      label: "fired note",
      dueAt: 1,
    })
    GoalState.pause(id)
  })

  test("a waiting goal owns only its matching wait", () => {
    const id = sid("claim-wait")
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_w", label: "later" }
    const metadata = { "kilo.goal": { text: "obj", status: "waiting", wait } }
    expect(GoalLink.claim(id, { id: "wku_w", prompt: "later" }, "wakeup", metadata)).toEqual(wait)
    expect(GoalLink.claim(id, { id: "wku_other", prompt: "nope" }, "wakeup", metadata)).toBeUndefined()
  })

  test("a session with no goal does not own a fire", () => {
    const id = sid("claim-none")
    expect(GoalLink.claim(id, { id: "wku_x", prompt: "x" }, "wakeup", {})).toBeUndefined()
  })

  test("a live wait is claimed after the run token drops", () => {
    const id = sid("claim-live")
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_live", label: "later" }
    GoalLink.set(id, wait)
    expect(GoalLink.claim(id, { id: "wku_live", prompt: "later" }, "wakeup", { "kilo.goal": { text: "obj", status: "active" } })).toEqual(
      wait,
    )
    expect(GoalLink.claim(id, { id: "wku_other", prompt: "nope" }, "wakeup", { "kilo.goal": { text: "obj", status: "active" } })).toBeUndefined()
    GoalLink.clear(id)
  })
})

describe("GoalLink.cleanup", () => {
  test("runs every registered handler even after one fails", async () => {
    const id = sid("cleanup")
    const seen: string[] = []
    const off1 = GoalLink.registerCleanup(() =>
      Effect.sync(() => {
        seen.push("first")
      }),
    )
    const off2 = GoalLink.registerCleanup(() => Effect.die(new Error("boom")))
    const off3 = GoalLink.registerCleanup(() =>
      Effect.sync(() => {
        seen.push("last")
      }),
    )
    try {
      await Effect.runPromise(GoalLink.cleanup(id))
      expect(seen).toEqual(["first", "last"])
    } finally {
      off1()
      off2()
      off3()
    }
  })

  test("the returned disposer unregisters a handler so a rebuild cannot stack", async () => {
    const id = sid("cleanup-off")
    const seen: string[] = []
    const off = GoalLink.registerCleanup(() =>
      Effect.sync(() => {
        seen.push("once")
      }),
    )
    off()
    await Effect.runPromise(GoalLink.cleanup(id))
    expect(seen).toEqual([])
  })
})

describe("GoalLink.release", () => {
  test("drops the wait, queued fire and arm for a removed session", async () => {
    const id = sid("release")
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_r", label: "later" }
    GoalLink.set(id, wait)
    GoalLink.pushPending(id, { note: "go", wait })
    GoalLink.registerArm(id, () => Effect.void)
    GoalLink.release(id)
    expect(GoalLink.get(id)).toBeUndefined()
    expect(GoalLink.takePending(id)).toEqual([])
    const exit = await Effect.runPromiseExit(GoalLink.arm(id, { sessionID: id, action: "resume" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("GoalState waiting", () => {
  test("reads and keeps a waiting goal's wait record", () => {
    const wait: GoalLink.Wait = { kind: "wakeup", id: "wku_w", label: "later", dueAt: 5 }
    expect(GoalState.read({ "kilo.goal": { text: "obj", status: "waiting", wait } })).toEqual({
      text: "obj",
      status: "waiting",
      active: false,
      wait,
    })
  })

  test("drops a malformed wait record", () => {
    expect(
      GoalState.read({ "kilo.goal": { text: "obj", status: "waiting", wait: { kind: "nope", id: "x" } } }),
    ).toEqual({ text: "obj", status: "waiting", active: false })
  })

  test("projects a waiting goal without reading it active or paused", () => {
    const id = sid("project")
    const metadata = {
      retained: true,
      "kilo.goal": { text: "obj", status: "waiting", wait: { kind: "process", id: "bgp_1", label: "bgp_1" } },
    }
    expect(GoalState.project(id, metadata)).toEqual({
      retained: true,
      "kilo.goal": {
        text: "obj",
        status: "waiting",
        active: false,
        wait: { kind: "process", id: "bgp_1", label: "bgp_1" },
      },
    })
  })

  test("hold covers waiting and active goals", () => {
    const id = sid("hold")
    expect(GoalState.hold(id)).toBe(false)
    GoalState.markWaiting(id)
    expect(GoalState.waiting(id)).toBe(true)
    expect(GoalState.hold(id)).toBe(true)
    GoalState.clearWaiting(id)
    expect(GoalState.hold(id)).toBe(false)
    GoalState.start(id)
    expect(GoalState.hold(id)).toBe(true)
    GoalState.pause(id)
    expect(GoalState.hold(id)).toBe(false)
  })
})

describe("GoalPolicy.available", () => {
  test("keeps the question gate while the goal waits and restores it after", () => {
    const id = sid("gate")
    expect(GoalPolicy.available(id, "question")).toBe(true)
    GoalState.markWaiting(id)
    expect(GoalPolicy.available(id, "question")).toBe(false)
    GoalState.clearWaiting(id)
    expect(GoalPolicy.available(id, "question")).toBe(true)
  })

  test("a wait-for-deploy goal hides explore tools but keeps every scheduling wait", () => {
    const id = sid("curb")
    expect(GoalPolicy.available(id, "bash")).toBe(true)
    GoalState.curb(id)
    expect(GoalPolicy.available(id, "bash")).toBe(false)
    expect(GoalPolicy.available(id, "read")).toBe(false)
    expect(GoalPolicy.available(id, "schedule_wakeup")).toBe(true)
    expect(GoalPolicy.available(id, "cron_create")).toBe(true)
    // The instruction text names background_process as a valid first call; a
    // non-terminal start or a monitor arms a process wait, so the curb allows it.
    expect(GoalPolicy.available(id, "background_process")).toBe(true)
    GoalLink.set(id, { kind: "wakeup", id: "wku_c", label: "x" })
    expect(GoalPolicy.available(id, "bash")).toBe(false)
    GoalState.pause(id)
    expect(GoalPolicy.available(id, "bash")).toBe(true)
    GoalLink.clear(id)
  })
})
