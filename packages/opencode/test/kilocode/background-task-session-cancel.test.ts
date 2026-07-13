import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskSessionCancel } from "../../src/kilocode/background-task-session-cancel"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

afterEach(() => {
  BackgroundTask.resetForTests()
})

describe("BackgroundTaskSessionCancel", () => {
  test("queued task cancellation calls SessionPrompt.cancel with exact childSessionID", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      let receivedSID: SessionID | undefined
      SessionPrompt.cancel = async (sid: SessionID) => {
        receivedSID = sid
      }

      await BackgroundTaskSessionCancel.cancel(claim)
      expect(receivedSID).toBe(child)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("running task cancellation calls SessionPrompt.cancel with exact childSessionID", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)

    const originalCancel = SessionPrompt.cancel
    try {
      let receivedSID: SessionID | undefined
      SessionPrompt.cancel = async (sid: SessionID) => {
        receivedSID = sid
      }

      await BackgroundTaskSessionCancel.cancel(created.claim)
      expect(receivedSID).toBe(child)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("registry status is already cancelled when SessionPrompt.cancel executes", async () => {
    const parent = sid()
    const child = sid()
    const { claim, info } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      let statusAtCallback: BackgroundTask.Status | undefined
      SessionPrompt.cancel = async () => {
        statusAtCallback = BackgroundTask.get(info.taskID)?.status
      }

      await BackgroundTaskSessionCancel.cancel(claim)
      expect(statusAtCallback).toBe("cancelled")
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("parent session ID is never passed", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      const received: SessionID[] = []
      SessionPrompt.cancel = async (sid: SessionID) => {
        received.push(sid)
      }

      await BackgroundTaskSessionCancel.cancel(claim)
      expect(received.length).toBe(1)
      expect(received[0]).toBe(child)
      expect(received[0]).not.toBe(parent)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("SessionPrompt.cancel is called exactly once", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      let count = 0
      SessionPrompt.cancel = async () => {
        count++
      }

      await BackgroundTaskSessionCancel.cancel(claim)
      expect(count).toBe(1)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("two concurrent cancel calls invoke SessionPrompt.cancel exactly once", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      let count = 0
      SessionPrompt.cancel = async () => {
        count++
      }

      const [r1, r2] = await Promise.all([
        BackgroundTaskSessionCancel.cancel(claim),
        BackgroundTaskSessionCancel.cancel(claim),
      ])

      const applied = [r1.applied, r2.applied]
      expect(applied.filter(Boolean).length).toBe(1)
      expect(count).toBe(1)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("second cancellation returns applied=false", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      SessionPrompt.cancel = async () => {}

      const r1 = await BackgroundTaskSessionCancel.cancel(claim)
      expect(r1.applied).toBe(true)

      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const r2 = await BackgroundTaskSessionCancel.cancel(claim)
      expect(r2.applied).toBe(false)
      expect(called).toBe(false)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("completed task does not call SessionPrompt.cancel", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)
    BackgroundTask.transitionToCompleted({ ...created.claim, resultMessageID: mid() })

    const originalCancel = SessionPrompt.cancel
    try {
      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const result = await BackgroundTaskSessionCancel.cancel(created.claim)
      expect(result.applied).toBe(false)
      expect(called).toBe(false)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("failed task does not call SessionPrompt.cancel", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)
    BackgroundTask.transitionToFailed({ ...created.claim, error: new Error("boom") })

    const originalCancel = SessionPrompt.cancel
    try {
      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const result = await BackgroundTaskSessionCancel.cancel(created.claim)
      expect(result.applied).toBe(false)
      expect(called).toBe(false)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("already-cancelled task does not call SessionPrompt.cancel", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToCancelled(created.claim)

    const originalCancel = SessionPrompt.cancel
    try {
      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const result = await BackgroundTaskSessionCancel.cancel(created.claim)
      expect(result.applied).toBe(false)
      expect(called).toBe(false)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("stale generation does not call SessionPrompt.cancel", async () => {
    const parent = sid()
    const child = sid()
    const first = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(first.claim)
    BackgroundTask.transitionToFailed({ ...first.claim, error: new Error("terminal") })

    const second = BackgroundTask.create({
      taskID: first.info.taskID,
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const result = await BackgroundTaskSessionCancel.cancel(first.claim)
      expect(result.applied).toBe(false)
      expect(called).toBe(false)
      expect(second.info.generation).toBe(first.info.generation + 1)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("missing task returns applied=false with info undefined", async () => {
    const fakeClaim: BackgroundTask.Claim = {
      taskID: "bg_nonexistent",
      generation: 1,
      ownerToken: Symbol("fake"),
    }

    const originalCancel = SessionPrompt.cancel
    try {
      let called = false
      SessionPrompt.cancel = async () => {
        called = true
      }

      const result = await BackgroundTaskSessionCancel.cancel(fakeClaim)
      expect(result.applied).toBe(false)
      expect(result.info).toBeUndefined()
      expect(called).toBe(false)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("synchronous SessionPrompt.cancel throw rejects with exact error and leaves registry cancelled", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const err = new Error("session cancel sync fail")
    const originalCancel = SessionPrompt.cancel
    let calls = 0
    try {
      const syncThrow = () => {
        calls++
        throw err
      }
      SessionPrompt.cancel = syncThrow as typeof SessionPrompt.cancel

      let rejected: unknown
      try {
        await BackgroundTaskSessionCancel.cancel(created.claim)
      } catch (e) {
        rejected = e
      }

      expect(rejected).toBe(err)
      expect(calls).toBe(1)
      expect(BackgroundTask.get(created.info.taskID)?.status).toBe("cancelled")
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("asynchronous SessionPrompt.cancel rejection rejects with exact error and leaves registry cancelled", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    const err = new Error("session cancel async fail")
    let calls = 0

    const asyncReject: typeof SessionPrompt.cancel = async () => {
      calls++
      await Promise.resolve()
      throw err
    }

    try {
      SessionPrompt.cancel = asyncReject

      let rejected: unknown
      try {
        await BackgroundTaskSessionCancel.cancel(created.claim)
      } catch (error) {
        rejected = error
      }

      expect(rejected).toBe(err)
      expect(calls).toBe(1)
      expect(BackgroundTask.get(created.info.taskID)?.status).toBe("cancelled")
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("successful adapter cancellation returns the exact A6 TransitionResult", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const originalCancel = SessionPrompt.cancel
    try {
      SessionPrompt.cancel = async () => {}

      const result = await BackgroundTaskSessionCancel.cancel(created.claim)
      expect(result.applied).toBe(true)
      expect(result.info).toBeDefined()
      expect(result.info?.taskID).toBe(created.info.taskID)
      expect(result.info?.status).toBe("cancelled")
      expect(result.info?.parentSessionID).toBe(parent)
      expect(result.info?.childSessionID).toBe(child)
    } finally {
      SessionPrompt.cancel = originalCancel
    }
  })

  test("production file has no forbidden behavior", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(
      new URL("../../src/kilocode/background-task-session-cancel.ts", import.meta.url),
      "utf-8",
    )

    expect(content).toContain("SessionPrompt")
    expect(content).toContain("BackgroundTaskCancel")
    expect(content).not.toContain("background_task")
    expect(content).not.toContain("BackgroundTaskRuntime")
    expect(content).not.toContain("background-task-completion")
    expect(content).not.toContain("background-task-start")
    expect(content).not.toContain("AbortSignal")
    expect(content).not.toContain("transitionToCancelled")
    expect(content).not.toMatch(/export.*parentSessionID/)

    const matches = content.match(/SessionPrompt.cancel/g)
    expect(matches?.length).toBe(1)
  })
})
