import { afterEach, describe, expect, test } from "bun:test"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

function seed() {
  return {
    parentSessionID: sid(),
    childSessionID: sid(),
    childUserMessageID: mid(),
  }
}

function create(input: Partial<BackgroundTask.CreateInput> = {}) {
  return BackgroundTask.create({
    ...seed(),
    ...input,
  })
}

function run(created: BackgroundTask.CreateResult, now = 20) {
  const next = BackgroundTask.transitionToRunning({
    ...created.claim,
    now,
  })
  expect(next.applied).toBe(true)
  expect(next.info).toBeDefined()
  return next
}

afterEach(() => {
  BackgroundTask.resetForTests()
})

describe("BackgroundTask registry", () => {
  test("create exposes claim separately and public snapshots do not expose ownerToken or leak mutations", () => {
    const created = create({ now: 10 })

    expect(created.claim.taskID).toBe(created.info.taskID)
    expect(created.claim.generation).toBe(created.info.generation)
    expect(typeof created.claim.ownerToken).toBe("symbol")
    expect("ownerToken" in created.info).toBe(false)

    const got = BackgroundTask.get(created.info.taskID)
    expect(got).toEqual(created.info)
    expect(got && "ownerToken" in got).toBe(false)

    const listed = BackgroundTask.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(created.info)
    expect(listed[0] && "ownerToken" in listed[0]).toBe(false)

    created.info.status = "running"
    expect(BackgroundTask.get(created.info.taskID)?.status).toBe("queued")

    const failed = BackgroundTask.transitionToFailed({
      ...created.claim,
      error: new TypeError("boom"),
      now: 11,
    })
    expect(failed.applied).toBe(true)
    expect(failed.info?.error).toEqual({
      name: "TypeError",
      message: "boom",
    })

    if (failed.info?.error) {
      failed.info.error.message = "changed"
    }
    expect(BackgroundTask.get(created.info.taskID)?.error).toEqual({
      name: "TypeError",
      message: "boom",
    })
  })

  test("create rejects live replacement and allows terminal restart only for the same parent", () => {
    const queued = create({ now: 20 })
    expect(() =>
      create({
        taskID: queued.info.taskID,
        parentSessionID: queued.info.parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        now: 21,
      }),
    ).toThrow("Background task already active")

    const running = create({ now: 22 })
    const live = run(running, 23)
    expect(live.info?.status).toBe("running")
    expect(() =>
      create({
        taskID: running.info.taskID,
        parentSessionID: running.info.parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        now: 24,
      }),
    ).toThrow("Background task already active")

    const done = create({ now: 25 })
    const stop = BackgroundTask.transitionToCancelled({
      ...done.claim,
      now: 26,
    })
    expect(stop.applied).toBe(true)

    const next = create({
      taskID: done.info.taskID,
      parentSessionID: done.info.parentSessionID,
      childSessionID: sid(),
      childUserMessageID: mid(),
      now: 27,
    })
    expect(next.info.taskID).toBe(done.info.taskID)
    expect(next.info.generation).toBe(done.info.generation + 1)
    expect(next.info.status).toBe("queued")
    expect(next.claim.ownerToken).not.toBe(done.claim.ownerToken)

    const other = create({ now: 28 })
    const fail = BackgroundTask.transitionToFailed({
      ...other.claim,
      error: { message: "stop" },
      now: 29,
    })
    expect(fail.applied).toBe(true)
    expect(() =>
      create({
        taskID: other.info.taskID,
        parentSessionID: sid(),
        childSessionID: sid(),
        childUserMessageID: mid(),
        now: 30,
      }),
    ).toThrow("Background task parent mismatch")
  })

  test("queued transitions cover legal paths, rejected paths, explicit results, and parent filtering", () => {
    const blocked = create({ now: 31 })
    const stay = BackgroundTask.transitionToCompleted({
      ...blocked.claim,
      resultMessageID: mid(),
      now: 32,
    })
    expect(stay.applied).toBe(false)
    expect(stay.info?.status).toBe("queued")
    expect(stay.info?.completedAt).toBeUndefined()

    const ready = create({ now: 33 })
    const live = BackgroundTask.transitionToRunning({
      ...ready.claim,
      now: 34,
    })
    expect(live.applied).toBe(true)
    expect(live.info?.status).toBe("running")
    expect(live.info?.startedAt).toBe(34)
    expect(live.info?.completedAt).toBeUndefined()

    const doomed = create({ now: 35 })
    const fail = BackgroundTask.transitionToFailed({
      ...doomed.claim,
      error: { message: "boom" },
      now: 36,
    })
    expect(fail.applied).toBe(true)
    expect(fail.info?.status).toBe("failed")
    expect(fail.info?.completedAt).toBe(36)
    expect(fail.info?.error).toEqual({ message: "boom" })
    expect(fail.info?.resultMessageID).toBeUndefined()

    const stop = create({ now: 37 })
    const gone = BackgroundTask.transitionToCancelled({
      ...stop.claim,
      now: 38,
    })
    expect(gone.applied).toBe(true)
    expect(gone.info?.status).toBe("cancelled")
    expect(gone.info?.completedAt).toBe(38)

    const again = BackgroundTask.transitionToCancelled({
      ...stop.claim,
      now: 39,
    })
    expect(again.applied).toBe(false)
    expect(again.info?.status).toBe("cancelled")

    const own = create({ parentSessionID: ready.info.parentSessionID, now: 40 })
    expect(BackgroundTask.list({ parentSessionID: ready.info.parentSessionID }).map((item) => item.taskID)).toEqual([
      ready.info.taskID,
      own.info.taskID,
    ])
  })

  test("running transitions cover legal paths and rejected paths", () => {
    const busy = create({ now: 41 })
    const live = run(busy, 42)
    const still = BackgroundTask.transitionToRunning({
      ...busy.claim,
      now: 43,
    })
    expect(still.applied).toBe(false)
    expect(still.info).toEqual(live.info)

    const doneBase = create({ now: 44 })
    run(doneBase, 45)
    const msg = mid()
    const done = BackgroundTask.transitionToCompleted({
      ...doneBase.claim,
      resultMessageID: msg,
      now: 46,
    })
    expect(done.applied).toBe(true)
    expect(done.info?.status).toBe("completed")
    expect(done.info?.completedAt).toBe(46)
    expect(done.info?.resultMessageID).toBe(msg)
    expect(done.info?.error).toBeUndefined()

    const failBase = create({ now: 47 })
    run(failBase, 48)
    const fail = BackgroundTask.transitionToFailed({
      ...failBase.claim,
      error: { name: "Oops", message: "x" },
      now: 49,
    })
    expect(fail.applied).toBe(true)
    expect(fail.info?.status).toBe("failed")
    expect(fail.info?.completedAt).toBe(49)
    expect(fail.info?.error).toEqual({ name: "Oops", message: "x" })

    const stopBase = create({ now: 50 })
    run(stopBase, 51)
    const stop = BackgroundTask.transitionToCancelled({
      ...stopBase.claim,
      now: 52,
    })
    expect(stop.applied).toBe(true)
    expect(stop.info?.status).toBe("cancelled")
    expect(stop.info?.completedAt).toBe(52)
  })

  test("terminal states reject later transitions and first terminal transition wins", () => {
    const doneBase = create({ now: 53 })
    run(doneBase, 54)
    const done = BackgroundTask.transitionToCompleted({
      ...doneBase.claim,
      resultMessageID: mid(),
      now: 55,
    })
    expect(done.applied).toBe(true)
    expect(BackgroundTask.transitionToFailed({ ...doneBase.claim, error: { message: "late" }, now: 56 })).toEqual({
      applied: false,
      info: done.info,
    })
    expect(BackgroundTask.transitionToCancelled({ ...doneBase.claim, now: 57 })).toEqual({
      applied: false,
      info: done.info,
    })
    expect(BackgroundTask.transitionToRunning({ ...doneBase.claim, now: 58 })).toEqual({
      applied: false,
      info: done.info,
    })

    const failBase = create({ now: 59 })
    run(failBase, 60)
    const fail = BackgroundTask.transitionToFailed({
      ...failBase.claim,
      error: { message: "first" },
      now: 61,
    })
    expect(fail.applied).toBe(true)
    expect(BackgroundTask.transitionToCompleted({ ...failBase.claim, resultMessageID: mid(), now: 62 })).toEqual({
      applied: false,
      info: fail.info,
    })
    expect(BackgroundTask.transitionToCancelled({ ...failBase.claim, now: 63 })).toEqual({
      applied: false,
      info: fail.info,
    })
    expect(BackgroundTask.transitionToRunning({ ...failBase.claim, now: 64 })).toEqual({
      applied: false,
      info: fail.info,
    })

    const stopBase = create({ now: 65 })
    run(stopBase, 66)
    const stop = BackgroundTask.transitionToCancelled({
      ...stopBase.claim,
      now: 67,
    })
    expect(stop.applied).toBe(true)
    expect(BackgroundTask.transitionToCompleted({ ...stopBase.claim, resultMessageID: mid(), now: 68 })).toEqual({
      applied: false,
      info: stop.info,
    })
    expect(BackgroundTask.transitionToFailed({ ...stopBase.claim, error: { message: "late" }, now: 69 })).toEqual({
      applied: false,
      info: stop.info,
    })
    expect(BackgroundTask.transitionToRunning({ ...stopBase.claim, now: 70 })).toEqual({
      applied: false,
      info: stop.info,
    })
    expect(BackgroundTask.transitionToCancelled({ ...stopBase.claim, now: 71 })).toEqual({
      applied: false,
      info: stop.info,
    })
  })

  test("wrong token, wrong generation, and missing tasks return applied false", () => {
    const created = create({ now: 72 })

    const wrongToken = BackgroundTask.transitionToRunning({
      taskID: created.info.taskID,
      ownerToken: Symbol(created.info.taskID),
      generation: created.claim.generation,
      now: 73,
    })
    expect(wrongToken.applied).toBe(false)
    expect(wrongToken.info).toEqual(created.info)

    const wrongGeneration = BackgroundTask.transitionToFailed({
      taskID: created.info.taskID,
      ownerToken: created.claim.ownerToken,
      generation: created.claim.generation + 1,
      error: { message: "bad" },
      now: 74,
    })
    expect(wrongGeneration.applied).toBe(false)
    expect(wrongGeneration.info).toEqual(created.info)

    const missing = BackgroundTask.transitionToCancelled({
      taskID: "bg_missing",
      ownerToken: Symbol("missing"),
      generation: 1,
      now: 75,
    })
    expect(missing).toEqual({
      applied: false,
      info: undefined,
    })
  })

  test("stale generation callbacks cannot mutate a restarted task", () => {
    const first = create({ now: 76 })
    const done = BackgroundTask.transitionToFailed({
      ...first.claim,
      error: { message: "done" },
      now: 77,
    })
    expect(done.applied).toBe(true)

    const next = create({
      taskID: first.info.taskID,
      parentSessionID: first.info.parentSessionID,
      childSessionID: sid(),
      childUserMessageID: mid(),
      now: 78,
    })
    expect(next.info.taskID).toBe(first.info.taskID)
    expect(next.info.generation).toBe(first.info.generation + 1)
    expect(next.claim.ownerToken).not.toBe(first.claim.ownerToken)
    expect(BackgroundTask.list()).toHaveLength(1)

    expect(BackgroundTask.transitionToRunning({ ...first.claim, now: 79 })).toEqual({
      applied: false,
      info: next.info,
    })
    expect(BackgroundTask.transitionToCompleted({ ...first.claim, resultMessageID: mid(), now: 80 })).toEqual({
      applied: false,
      info: next.info,
    })
    expect(BackgroundTask.transitionToFailed({ ...first.claim, error: { message: "stale" }, now: 81 })).toEqual({
      applied: false,
      info: next.info,
    })
    expect(BackgroundTask.transitionToCancelled({ ...first.claim, now: 82 })).toEqual({
      applied: false,
      info: next.info,
    })

    const live = BackgroundTask.transitionToRunning({
      ...next.claim,
      now: 83,
    })
    expect(live.applied).toBe(true)
    expect(live.info?.status).toBe("running")
    expect(live.info?.generation).toBe(next.info.generation)
  })
})
