import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskCompletion } from "../../src/kilocode/background-task-completion"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function defer<T>(): Deferred<T> {
  let res: (value: T) => void
  let rej: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    res = resolve
    rej = reject
  })
  return { promise, resolve: res!, reject: rej! }
}

function createRunning() {
  const created = BackgroundTask.create({
    parentSessionID: sid(),
    childSessionID: sid(),
    childUserMessageID: mid(),
  })
  const started = BackgroundTask.transitionToRunning(created.claim)
  expect(started.applied).toBe(true)
  return created
}

afterEach(() => BackgroundTask.resetForTests())

describe("BackgroundTaskCompletion", () => {
  test("pending completion leaves a running task running", async () => {
    const created = createRunning()
    const completion = defer<{ resultMessageID: MessageID }>()

    const p = BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: completion.promise,
    })

    await Bun.sleep(10)
    const info = BackgroundTask.get(created.info.taskID)
    expect(info?.status).toBe("running")

    completion.resolve({ resultMessageID: mid() })
    await p
  })

  test("fulfillment transitions running to completed", async () => {
    const created = createRunning()
    const result = mid()

    const p = BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.resolve({ resultMessageID: result }),
    })

    const tr = await p
    expect(tr.applied).toBe(true)
    expect(tr.info?.status).toBe("completed")
    expect(tr.info?.completedAt).toBeDefined()
  })

  test("the exact resultMessageID is stored", async () => {
    const created = createRunning()
    const result = mid()

    const tr = await BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.resolve({ resultMessageID: result }),
    })

    expect(tr.applied).toBe(true)
    expect(tr.info?.resultMessageID).toBe(result)
    const stored = BackgroundTask.get(created.info.taskID)
    expect(stored?.resultMessageID).toBe(result)
  })

  test("no full completion object is retained", async () => {
    const created = createRunning()
    const result = mid()

    const tr = await BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.resolve({ resultMessageID: result }),
    })

    expect(tr.applied).toBe(true)
    expect("completion" in (tr.info as any)).toBe(false)
    expect("promise" in (tr.info as any)).toBe(false)
  })

  test("rejection transitions running to failed", async () => {
    const created = createRunning()
    const boom = new Error("child crashed")

    const tr = await BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.reject(boom),
    })

    expect(tr.applied).toBe(true)
    expect(tr.info?.status).toBe("failed")
    expect(tr.info?.error).toEqual({
      name: "Error",
      message: "child crashed",
    })
  })
  test("rejection is sanitized by the existing registry", async () => {
    const created = createRunning()
    const thrown = "raw string error"

    const tr = await BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.reject(thrown),
    })

    expect(tr.applied).toBe(true)
    expect(tr.info?.status).toBe("failed")
    expect(tr.info?.error).toEqual({
      message: "raw string error",
    })
  })

  test("observe resolves rather than rejects on child failure", async () => {
    const created = createRunning()
    const boom = new TypeError("boom")

    const tr = await BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: Promise.reject(boom),
    })

    expect(tr.applied).toBe(true)
    expect(tr.info?.status).toBe("failed")
  })

  test("cancellation before fulfillment wins and late fulfillment returns applied false", async () => {
    const created = createRunning()
    const completion = defer<{ resultMessageID: MessageID }>()

    const p = BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: completion.promise,
    })

    const cancelled = BackgroundTask.transitionToCancelled(created.claim)
    expect(cancelled.applied).toBe(true)

    completion.resolve({ resultMessageID: mid() })
    const tr = await p
    expect(tr.applied).toBe(false)
    expect(tr.info?.status).toBe("cancelled")
  })

  test("cancellation before rejection wins and late rejection returns applied false", async () => {
    const created = createRunning()
    const completion = defer<{ resultMessageID: MessageID }>()

    const p = BackgroundTaskCompletion.observe({
      claim: created.claim,
      completion: completion.promise,
    })

    const cancelled = BackgroundTask.transitionToCancelled(created.claim)
    expect(cancelled.applied).toBe(true)

    completion.reject(new Error("late fail"))
    const tr = await p
    expect(tr.applied).toBe(false)
    expect(tr.info?.status).toBe("cancelled")
  })

  test("stale generation cannot modify a restarted task", async () => {
    const first = createRunning()
    const firstResult = mid()

    const p = BackgroundTaskCompletion.observe({
      claim: first.claim,
      completion: Promise.resolve({ resultMessageID: firstResult }),
    })

    const cancelled = BackgroundTask.transitionToCancelled(first.claim)
    expect(cancelled.applied).toBe(true)

    const second = BackgroundTask.create({
      taskID: first.info.taskID,
      parentSessionID: first.info.parentSessionID,
      childSessionID: sid(),
      childUserMessageID: mid(),
    })
    const secondStarted = BackgroundTask.transitionToRunning(second.claim)
    expect(secondStarted.applied).toBe(true)

    const tr = await p
    expect(tr.applied).toBe(false)

    const current = BackgroundTask.get(first.info.taskID)
    expect(current?.status).toBe("running")
    expect(current?.generation).toBe(second.info.generation)
  })
  test("missing task returns applied false with info undefined", async () => {
    const result = await BackgroundTaskCompletion.observe({
      claim: {
        taskID: "bg_nonexistent",
        generation: 1,
        ownerToken: Symbol("missing"),
      },
      completion: Promise.resolve({ resultMessageID: mid() }),
    })

    expect(result.applied).toBe(false)
    expect(result.info).toBeUndefined()
  })

  test("no SessionPrompt, cancellation, startup, or public-tool behavior exists", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/kilocode/background-task-completion.ts"), "utf8")
    expect(src).not.toContain("SessionPrompt")
    expect(src).not.toContain("cancel")
    expect(src).not.toContain("BackgroundTaskStartAck")
    expect(src).not.toContain("tool")
  })
})
