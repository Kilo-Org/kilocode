import { describe, expect, it } from "bun:test"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import {
  TaskStateBridge,
  type KiloTaskStateChangeEvent,
  type TaskStateEmitter,
} from "../../src/services/public-api/task-state"

/** Minimal functional emitter so tests observe real emissions. */
class RecordingEmitter implements TaskStateEmitter {
  readonly listeners = new Set<(data: KiloTaskStateChangeEvent) => void>()
  readonly events: KiloTaskStateChangeEvent[] = []
  disposed = false
  event = (listener: (data: KiloTaskStateChangeEvent) => void) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  fire = (data: KiloTaskStateChangeEvent) => {
    this.events.push(data)
    for (const listener of this.listeners) listener(data)
  }
  dispose = () => {
    this.disposed = true
    this.listeners.clear()
  }
}

type Handler = (event: SSEPayload, directory?: string) => void

function fixture(opts?: { logs?: string[]; approve?: () => boolean | Promise<boolean> }) {
  const handlers: Handler[] = []
  const stateHandlers: ((state: string) => void)[] = []
  const emitter = new RecordingEmitter()
  const logs: string[] = opts?.logs ?? []
  const bridge = new TaskStateBridge(
    {
      onEvent: (listener: Handler) => {
        handlers.push(listener)
        return () => {}
      },
      onStateChange: (listener: (state: string) => void) => {
        stateHandlers.push(listener)
        return () => {}
      },
    },
    { emitter, log: (line) => logs.push(line), approve: opts?.approve },
  )
  const received: KiloTaskStateChangeEvent[] = []
  bridge.onDidChangeTaskState((change) => received.push(change))
  const emit = (event: object) => {
    for (const handler of handlers) handler(event as SSEPayload)
  }
  const states = () => received.map((change) => [change.previousState, change.state] as const)
  return { bridge, emitter, received, emit, states, logs, stateHandlers }
}

const busy = (sid: string) => ({
  type: "session.status",
  id: "e",
  properties: { sessionID: sid, status: { type: "busy" } },
})
const close = (sid: string, reason: string, parentID?: string) => ({
  type: "session.turn.close",
  id: "e",
  properties: { sessionID: sid, reason, ...(parentID !== undefined ? { parentID } : {}) },
})
const sessionError = (sid: string, name: string) => ({
  type: "session.error",
  id: "e",
  properties: { sessionID: sid, error: { name, data: { message: "boom" } } },
})
const question = (sid: string, id: string) => ({
  type: "question.asked",
  id: "e",
  properties: { id, sessionID: sid, questions: [{ question: "Continue?", header: "Confirm", options: [] }] },
})
const questionReplied = (sid: string, requestID: string) => ({
  type: "question.replied",
  id: "e",
  properties: { sessionID: sid, requestID, answers: [] },
})
const permission = (sid: string, id: string) => ({
  type: "permission.asked",
  id: "e",
  properties: { id, sessionID: sid, permission: "bash", patterns: [], always: [], metadata: {} },
})
const permissionReplied = (sid: string, requestID: string) => ({
  type: "permission.replied",
  id: "e",
  properties: { sessionID: sid, requestID, reply: "once" },
})
const sessionUpdated = (sid: string, title?: string, goalActive?: boolean) => ({
  type: "sync",
  name: "session.updated.1",
  id: "e",
  seq: 1,
  aggregateID: sid,
  data: {
    sessionID: sid,
    info: {
      id: sid,
      title,
      metadata: goalActive === undefined ? undefined : { "kilo.goal": { text: "g", active: goalActive } },
    },
  },
})

describe("TaskStateBridge event mapping", () => {
  it("maps busy status to running with previousState", () => {
    const f = fixture()
    f.emit(busy("s1"))
    expect(f.states()).toEqual([[undefined, "running"]])
  })

  it("maps successful completion to done", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(close("s1", "completed"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "done"],
    ])
  })

  it("maps failure to error when a failing turn closes", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(sessionError("s1", "ApiError"))
    f.emit(close("s1", "completed"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "error"],
    ])
  })

  it("maps close reason error without a prior session.error", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(close("s1", "error"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "error"],
    ])
  })

  it("maps interruption and supersession to cancelled", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(close("s1", "interrupted"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "cancelled"],
    ])
    f.emit(busy("s1"))
    f.emit(close("s1", "superseded"))
    expect(f.states()[3]).toEqual(["running", "cancelled"])
  })

  it("maps question and permission waiting to needsInput and replies back to running", async () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(question("s1", "q1"))
    f.emit(question("s1", "q2")) // already needsInput: no duplicate transition
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "needsInput"],
    ])
    f.emit(questionReplied("s1", "q1"))
    expect(f.states().length).toBe(2) // one question still pending
    f.emit(questionReplied("s1", "q2"))
    expect(f.states()[2]).toEqual(["needsInput", "running"])

    f.emit(permission("s1", "p1"))
    expect(f.states()[3]).toEqual(["running", "needsInput"])
    f.emit(permissionReplied("s1", "p1"))
    expect(f.states()[4]).toEqual(["needsInput", "running"])
  })

  it("suppresses needsInput for auto-approved permissions", async () => {
    const f = fixture({ approve: () => true })
    f.emit(busy("s1"))
    f.emit(permission("s1", "p1"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.states()).toEqual([[undefined, "running"]])
  })

  it("does not lift needsInput on a busy status replay", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(question("s1", "q1"))
    f.emit(busy("s1"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "needsInput"],
    ])
  })

  it("ignores idle status and aborts are cancelled, not errors", () => {
    const f = fixture()
    f.emit({ type: "session.status", id: "e", properties: { sessionID: "s1", status: { type: "idle" } } })
    f.emit(busy("s1"))
    f.emit(sessionError("s1", "MessageAbortedError"))
    f.emit(close("s1", "interrupted"))
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "cancelled"],
    ])
  })

  it("skips child session completions and active goal sessions", () => {
    const f = fixture()
    f.emit(busy("child"))
    f.emit(close("child", "completed", "root-session"))
    // The child session started (running), but its completion is a step of the
    // parent task, not a user-visible "done".
    expect(f.states()).toEqual([[undefined, "running"]])

    f.emit(sessionUpdated("goal", "A goal", true))
    f.emit(busy("goal"))
    f.emit(close("goal", "completed"))
    // Both sessions reached running; neither produced a "done".
    expect(f.states()).toEqual([
      [undefined, "running"],
      [undefined, "running"],
    ])
  })

  it("carries the session title from sync events", () => {
    const f = fixture()
    f.emit(sessionUpdated("s1", "Refactor authentication"))
    f.emit(busy("s1"))
    f.emit(close("s1", "completed"))
    expect(f.received[1].title).toBe("Refactor authentication")
  })

  it("handles unknown states safely without leaking content", () => {
    const logs: string[] = []
    const f = fixture({ logs })
    f.emit({ type: "session.status", id: "e", properties: { sessionID: "s1", status: { type: "waiting" } } })
    f.emit(busy("s1"))
    f.emit(close("s1", "mystery"))
    expect(f.states()).toEqual([[undefined, "running"]])
    expect(logs.some((line) => line.includes("unknown session status type"))).toBe(true)
    expect(logs.some((line) => line.includes("unknown turn close reason"))).toBe(true)
  })

  it("does not emit duplicate transitions for repeated identical states", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(busy("s1")) // replay
    f.emit(close("s1", "completed"))
    f.emit(close("s1", "completed")) // replay without a new busy
    expect(f.states()).toEqual([
      [undefined, "running"],
      ["running", "done"],
    ])
  })

  it("resets per-session state on connection loss", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit(close("s1", "completed"))
    for (const handler of f.stateHandlers) handler("disconnected")
    f.emit(busy("s1")) // fresh session start after reconnect
    expect(f.states()[2]).toEqual([undefined, "running"])
  })

  it("cleans up on session deletion", () => {
    const f = fixture()
    f.emit(busy("s1"))
    f.emit({ type: "session.deleted", id: "e", properties: { sessionID: "s1", info: {} } })
    f.emit(close("s1", "completed")) // not active anymore
    expect(f.states()).toEqual([[undefined, "running"]])
  })
})

describe("TaskStateBridge public API", () => {
  it("exposes a versioned, read-only api with frozen events", async () => {
    const f = fixture()
    const api = f.bridge.api
    expect(api.apiVersion).toBe(1)
    expect(typeof api.onDidChangeTaskState).toBe("function")
    expect(Object.isFrozen(api)).toBe(true)

    f.emit(busy("s1"))
    f.emit(close("s1", "completed"))
    const tasks = await api.getCurrentTasks()
    expect(tasks.length).toBe(1)
    expect(tasks[0].state).toBe("done")
    expect(Object.isFrozen(tasks[0])).toBe(true)
    expect(() => {
      ;(tasks[0] as { state: string }).state = "running"
    }).toThrow()
  })

  it("disposes subscriptions and the emitter, and survives a throwing listener", () => {
    const f = fixture()
    f.bridge.onDidChangeTaskState(() => {
      throw new Error("bad listener")
    })
    f.emit(busy("s1"))
    expect(f.emitter.events.length).toBe(1) // the throwing listener did not break the bridge
    expect(f.received.length).toBe(1)

    f.bridge.dispose()
    expect(f.emitter.disposed).toBe(true)
    f.emit(busy("s2")) // unsubscribed: no crash, no event
    expect(f.emitter.events.length).toBe(1)
  })

  it("does not require any consumer for normal operation", () => {
    const f = fixture()
    f.emit(busy("s1")) // no listeners registered: no error, event still routed
    expect(f.emitter.events.length).toBe(1)
  })
})
