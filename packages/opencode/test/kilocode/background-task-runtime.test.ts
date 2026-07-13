import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskRuntime } from "../../src/kilocode/background-task-runtime"
import { tmpdir } from "../fixture/fixture"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
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

afterEach(() => {
  BackgroundTaskRuntime.resetForTests()
  BackgroundTask.resetForTests()
  Instance.disposeAll()
})

describe("BackgroundTaskRuntime", () => {
  // TEST FIX 1: exact then instrumentation, no unused variables
  test("original completion handlers are attached before launch executes", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    let thenCalls = 0

    const completion = new Promise<{ resultMessageID: MessageID }>((resolve) => {
      resolve({ resultMessageID: mid() })
    })
    const originalThen = completion.then

    try {
      Object.defineProperty(completion, "then", {
        value: function (onFulfilled: any, onRejected: any) {
          thenCalls++
          return originalThen.call(this, onFulfilled, onRejected)
        },
        configurable: true,
        writable: true,
      })

      await withInstance(tmp.path, async () => {
        const p = BackgroundTaskRuntime.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            expect(thenCalls).toBeGreaterThan(0)
            void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
          },
          completion,
        })
        await p
      })
    } finally {
      Object.defineProperty(completion, "then", {
        value: originalThen,
        configurable: true,
        writable: true,
      })
    }
  })

  test("start returns after TurnOpen without waiting for pending completion", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      const result = await Promise.race([
        p.then((r) => ({ returned: true as const, status: r.info.status })),
        Bun.sleep(200).then(() => ({ returned: false as const, status: "timeout" as const })),
      ])
      expect(result.returned).toBe(true)
      expect(result.status).toBe("running")

      completion.resolve({ resultMessageID: mid() })
    })
  })

  test("pending completion is retained after start returns", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      expect(BackgroundTaskRuntime.isObserving(result.claim)).toBe(true)
      expect(BackgroundTask.get(result.info.taskID)?.status).toBe("running")

      completion.resolve({ resultMessageID: mid() })
    })
  })

  test("fulfillment after start transitions running to completed", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      const resultMsg = mid()
      completion.resolve({ resultMessageID: resultMsg })

      await Bun.sleep(20)
      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("completed")
      expect(info?.resultMessageID).toBe(resultMsg)
    })
  })

  test("exact resultMessageID is stored after fulfillment", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      const specificMsg = MessageID.make(Identifier.ascending("message"))
      completion.resolve({ resultMessageID: specificMsg })

      await Bun.sleep(20)
      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("completed")
      expect(info?.resultMessageID).toBe(specificMsg)
    })
  })

  test("rejection transitions running to failed", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      const err = new Error("child crashed")
      completion.reject(err)

      await Bun.sleep(20)
      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("failed")
      expect(info?.error?.message).toBe("child crashed")
    })
  })

  test("observer retention removed after fulfillment", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      expect(BackgroundTaskRuntime.isObserving(result.claim)).toBe(true)

      completion.resolve({ resultMessageID: mid() })
      await Bun.sleep(20)

      expect(BackgroundTaskRuntime.isObserving(result.claim)).toBe(false)
    })
  })

  test("observer retention removed after rejection", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      expect(BackgroundTaskRuntime.isObserving(result.claim)).toBe(true)

      completion.reject(new Error("boom"))
      await Bun.sleep(20)

      expect(BackgroundTaskRuntime.isObserving(result.claim)).toBe(false)
    })
  })

  test("completion fulfilled before TurnOpen not lost", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const specificMsg = MessageID.make(Identifier.ascending("message"))
    const completion = Promise.resolve<{ resultMessageID: MessageID }>({ resultMessageID: specificMsg })

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion,
      })

      expect(BackgroundTask.get(result.info.taskID)?.status).toBe("running")

      await Bun.sleep(20)
      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("completed")
      expect(info?.resultMessageID).toBe(specificMsg)
    })
  })

  test("completion rejection before TurnOpen fails startup instead of hanging", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const err = new Error("pre-open crash")

    await withInstance(tmp.path, async () => {
      let launchCount = 0

      await expect(
        BackgroundTaskRuntime.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            launchCount++
          },
          completion: Promise.reject<{ resultMessageID: MessageID }>(err),
        }),
      ).rejects.toBe(err)

      expect(launchCount).toBe(1)

      const info = BackgroundTask.list({ parentSessionID: parent })
      expect(info).toHaveLength(1)
      expect(info[0].status).toBe("failed")
      expect(info[0].startedAt).toBeUndefined()
      expect(info[0].error?.message).toBe("pre-open crash")
    })
  })

  test("early fulfillment does not complete while queued", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const specificMsg = MessageID.make(Identifier.ascending("message"))
    const completion = Promise.resolve<{ resultMessageID: MessageID }>({ resultMessageID: specificMsg })

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion,
      })

      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("running")
      expect(info?.resultMessageID).toBeUndefined()

      await Bun.sleep(20)
      const infoAfter = BackgroundTask.get(result.info.taskID)
      expect(infoAfter?.status).toBe("completed")
      expect(infoAfter?.resultMessageID).toBe(specificMsg)
    })
  })

  test("completion rejection during launch before TurnOpen fails startup", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()
    const err = new Error("launch-time crash")

    await withInstance(tmp.path, async () => {
      await expect(
        BackgroundTaskRuntime.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            completion.reject(err)
          },
          completion: completion.promise,
        }),
      ).rejects.toBe(err)

      const info = BackgroundTask.list({ parentSessionID: parent })
      expect(info).toHaveLength(1)
      expect(info[0].status).toBe("failed")
      expect(info[0].startedAt).toBeUndefined()
      expect(info[0].error?.message).toBe("launch-time crash")
    })
  })

  test("completion rejection beats TurnOpen race without double transition", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()
    const err = new Error("race crash")
    let runCount = 0
    let failCount = 0
    const origRunning = BackgroundTask.transitionToRunning
    const origFailed = BackgroundTask.transitionToFailed

    try {
      Object.defineProperty(BackgroundTask, "transitionToRunning", {
        value: (claim: Parameters<typeof origRunning>[0]) => {
          runCount++
          return origRunning(claim)
        },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(BackgroundTask, "transitionToFailed", {
        value: (input: Parameters<typeof origFailed>[0]) => {
          failCount++
          return origFailed(input)
        },
        configurable: true,
        writable: true,
      })

      await withInstance(tmp.path, async () => {
        await expect(
          BackgroundTaskRuntime.start({
            parentSessionID: parent,
            childSessionID: child,
            childUserMessageID: msg,
            launch: () => {
              queueMicrotask(() => completion.reject(err))
              setTimeout(() => {
                void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
              }, 0)
            },
            completion: completion.promise,
          }),
        ).rejects.toBe(err)

        await Bun.sleep(20)

        const info = BackgroundTask.list({ parentSessionID: parent })
        expect(info).toHaveLength(1)
        expect(info[0].status).toBe("failed")
        expect(info[0].startedAt).toBeUndefined()
        expect(runCount).toBe(0)
        expect(failCount).toBe(1)
      })
    } finally {
      Object.defineProperty(BackgroundTask, "transitionToRunning", {
        value: origRunning,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(BackgroundTask, "transitionToFailed", {
        value: origFailed,
        configurable: true,
        writable: true,
      })
    }
  })

  test("cancellation after startup wins over late completion", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    await withInstance(tmp.path, async () => {
      const result = await BackgroundTaskRuntime.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        completion: completion.promise,
      })

      expect(result.info.status).toBe("running")

      BackgroundTask.transitionToCancelled(result.claim)
      expect(BackgroundTask.get(result.info.taskID)?.status).toBe("cancelled")

      completion.resolve({ resultMessageID: mid() })
      await Bun.sleep(20)

      expect(BackgroundTask.get(result.info.taskID)?.status).toBe("cancelled")
    })
  })

  test("launch failure with pending completion rejects promptly", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()
    const completion = defer<{ resultMessageID: MessageID }>()

    try {
      await withInstance(tmp.path, async () => {
        const launchErr = new Error("launch failed")

        const startP = BackgroundTaskRuntime.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            throw launchErr
          },
          completion: completion.promise,
        })

        const outcome = await Promise.race([
          startP.then(() => ({ settled: true as const })).catch((e) => ({ settled: true as const, error: e })),
          Bun.sleep(200).then(() => ({ settled: false as const })),
        ])

        expect(outcome.settled).toBe(true)
        if ("error" in outcome) {
          expect(outcome.error).toBe(launchErr)
        }

        const claims = BackgroundTask.list({ parentSessionID: parent })
        expect(claims.length).toBe(1)
        expect(claims[0].status).toBe("failed")
        expect(claims[0].error?.message).toBe("launch failed")
        expect(BackgroundTaskRuntime.isObserving(claims[0] as any)).toBe(false)
      })
    } finally {
      // Promise cleanup: settle the pending completion
      completion.resolve({ resultMessageID: mid() })
    }
  })

  test("production file has no forbidden imports", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/background-task-runtime.ts", import.meta.url), "utf-8")

    expect(content).not.toContain("background-task-start-ack")
    expect(content).not.toContain("@/util/process")
    expect(content).toContain("background-task-start")
    expect(content).toContain("background-task-completion")
    expect(content).toContain("background-task")
  })
})
