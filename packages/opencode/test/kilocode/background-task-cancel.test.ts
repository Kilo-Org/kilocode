import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskCancel } from "../../src/kilocode/background-task-cancel"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

afterEach(() => {
  BackgroundTask.resetForTests()
})

describe("BackgroundTaskCancel", () => {
  test("queued task transitions to cancelled", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(true)
    expect(result.info?.status).toBe("cancelled")
    expect(called).toBe(true)
  })

  test("running task transitions to cancelled", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: created.claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(true)
    expect(result.info?.status).toBe("cancelled")
    expect(called).toBe(true)
  })

  test("cancelChild receives the exact registry childSessionID", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let receivedSID: SessionID | undefined
    await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: (sid) => {
        receivedSID = sid
      },
    })

    expect(receivedSID).toBe(child)
  })

  test("cancelChild executes only after registry status is cancelled", async () => {
    const parent = sid()
    const child = sid()
    const { claim, info } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let statusAtCallback: BackgroundTask.Status | undefined
    await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: () => {
        statusAtCallback = BackgroundTask.get(info.taskID)?.status
      },
    })

    expect(statusAtCallback).toBe("cancelled")
  })

  test("cancelChild is invoked exactly once", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let count = 0
    await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: () => {
        count++
      },
    })

    expect(count).toBe(1)
  })

  test("successful cancellation returns the exact transition result", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const result = await BackgroundTaskCancel.cancel({
      claim: created.claim,
      cancelChild: () => {},
    })

    expect(result.applied).toBe(true)
    expect(result.info).toBeDefined()
    expect(result.info?.taskID).toBe(created.info.taskID)
    expect(result.info?.status).toBe("cancelled")
    expect(result.info?.parentSessionID).toBe(parent)
    expect(result.info?.childSessionID).toBe(child)
  })

  test("concurrent cancellation invokes cancelChild only once", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let count = 0
    const cancelChild = () => {
      count++
    }

    const [r1, r2] = await Promise.all([
      BackgroundTaskCancel.cancel({ claim, cancelChild }),
      BackgroundTaskCancel.cancel({ claim, cancelChild }),
    ])

    const applied = [r1.applied, r2.applied]
    expect(applied.filter(Boolean).length).toBe(1)
    expect(count).toBe(1)
  })

  test("second cancellation returns applied=false", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const r1 = await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: () => {},
    })
    expect(r1.applied).toBe(true)

    let called = false
    const r2 = await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: () => {
        called = true
      },
    })
    expect(r2.applied).toBe(false)
    expect(called).toBe(false)
  })

  test("completed tasks do not invoke cancelChild", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)
    BackgroundTask.transitionToCompleted({ ...created.claim, resultMessageID: mid() })

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: created.claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(false)
    expect(called).toBe(false)
  })

  test("failed tasks do not invoke cancelChild", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(created.claim)
    BackgroundTask.transitionToFailed({ ...created.claim, error: new Error("boom") })

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: created.claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(false)
    expect(called).toBe(false)
  })

  test("already-cancelled tasks do not invoke cancelChild", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToCancelled(created.claim)

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: created.claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(false)
    expect(called).toBe(false)
  })

  test("stale generation does not invoke cancelChild", async () => {
    const parent = sid()
    const child = sid()
    const first = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })
    BackgroundTask.transitionToRunning(first.claim)
    BackgroundTask.transitionToFailed({ ...first.claim, error: new Error("terminal") })

    // Re-create with same taskID to bump generation
    const second = BackgroundTask.create({
      taskID: first.info.taskID,
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: first.claim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(false)
    expect(called).toBe(false)
    expect(second.info.generation).toBe(first.info.generation + 1)
  })

  test("missing task returns applied=false with info undefined", async () => {
    const parent = sid()
    const child = sid()
    const fakeClaim: BackgroundTask.Claim = {
      taskID: "bg_nonexistent",
      generation: 1,
      ownerToken: Symbol("fake"),
    }

    let called = false
    const result = await BackgroundTaskCancel.cancel({
      claim: fakeClaim,
      cancelChild: () => {
        called = true
      },
    })

    expect(result.applied).toBe(false)
    expect(result.info).toBeUndefined()
    expect(called).toBe(false)
  })

  test("synchronous callback throw preserves cancelled state and rejects with exact error", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const err = new Error("cancel sync fail")
    let rejected: unknown
    try {
      await BackgroundTaskCancel.cancel({
        claim: created.claim,
        cancelChild: () => {
          throw err
        },
      })
    } catch (e) {
      rejected = e
    }

    expect(rejected).toBe(err)
    // Registry state preserved as cancelled
    const info = BackgroundTask.get(created.info.taskID)
    expect(info?.status).toBe("cancelled")
  })

  test("async callback rejection preserves cancelled state and rejects with exact error", async () => {
    const parent = sid()
    const child = sid()
    const created = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const err = new Error("cancel async fail")
    let rejected: unknown
    try {
      await BackgroundTaskCancel.cancel({
        claim: created.claim,
        cancelChild: async () => {
          throw err
        },
      })
    } catch (e) {
      rejected = e
    }

    expect(rejected).toBe(err)
    // Registry state preserved as cancelled
    const info = BackgroundTask.get(created.info.taskID)
    expect(info?.status).toBe("cancelled")
  })

  test("no parent session ID is passed to the callback", async () => {
    const parent = sid()
    const child = sid()
    const { claim } = BackgroundTask.create({
      parentSessionID: parent,
      childSessionID: child,
      childUserMessageID: mid(),
    })

    const received: SessionID[] = []
    await BackgroundTaskCancel.cancel({
      claim,
      cancelChild: (sid) => {
        received.push(sid)
      },
    })

    expect(received.length).toBe(1)
    expect(received[0]).toBe(child)
    expect(received[0]).not.toBe(parent)
  })

  test("no SessionPrompt, runtime, public-tool, completion, or result-fetch behavior exists", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/background-task-cancel.ts", import.meta.url), "utf-8")

    expect(content).not.toContain("SessionPrompt")
    expect(content).not.toContain("BackgroundTaskRuntime")
    expect(content).not.toContain("background_task")
    expect(content).not.toContain("background-task-runtime")
    expect(content).not.toContain("background-task-completion")
    expect(content).not.toContain("background-task-start")
    expect(content).toContain("BackgroundTask")
    expect(content).toContain("transitionToCancelled")
    expect(content).toContain("cancelChild")
  })
})
