import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskStartAck } from "../../src/kilocode/background-task-start-ack"
import { BackgroundTaskStart } from "../../src/kilocode/background-task-start"
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

afterEach(() => {
  BackgroundTask.resetForTests()
  Instance.disposeAll()
})

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

describe("BackgroundTaskStart", () => {
  test("registry entry is queued before launch executes", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      let launched = false
      const done = defer<void>()

      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          const info = BackgroundTask.list({ parentSessionID: parent })
          expect(info).toHaveLength(1)
          expect(info[0].status).toBe("queued")
          expect(info[0].childSessionID).toBe(child)
          launched = true
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      const result = await Promise.race([
        p.then(() => "resolved" as const),
        Bun.sleep(200).then(() => "timeout" as const),
      ])
      expect(result).toBe("resolved")
      expect(launched).toBe(true)
    })
  })

  test("launch is invoked exactly once", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      let launchCount = 0

      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          launchCount++
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      await p
      expect(launchCount).toBe(1)
    })
  })

  test("TurnOpen emitted from launch is not missed", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      const result = await Promise.race([
        p.then((r) => ({ status: r.info.status })),
        Bun.sleep(200).then(() => ({ status: "timeout" as const })),
      ])
      expect(result.status).toBe("running")
    })
  })

  test("unrelated TurnOpen does not start the task", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const other = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: other })
        },
      })

      const result = await Promise.race([
        p.then(() => "resolved" as const),
        Bun.sleep(100).then(() => "pending" as const),
      ])
      expect(result).toBe("pending")

      const info = BackgroundTask.list({ parentSessionID: parent })
      expect(info).toHaveLength(1)
      expect(info[0].status).toBe("queued")

      await Bus.publish(Session.Event.TurnOpen, { sessionID: child })
      await Bun.sleep(20)

      const after = await Promise.race([
        p.then((r) => ({ status: r.info.status })),
        Bun.sleep(100).then(() => ({ status: "timeout" as const })),
      ])
      expect(after.status).toBe("running")
    })
  })
  test("exact TurnOpen transitions queued to running", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      const result = await p
      expect(result.info.status).toBe("running")
      expect(result.info.startedAt).toBeDefined()
    })
  })

  test("returned claim is the original registry ownership claim", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      const result = await p
      expect(typeof result.claim.ownerToken).toBe("symbol")
      expect(result.claim.taskID).toBe(result.info.taskID)
      expect(result.claim.generation).toBe(result.info.generation)
    })
  })

  test("returned info is running with exact child identifiers", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
      })

      const result = await p
      expect(result.info.status).toBe("running")
      expect(result.info.parentSessionID).toBe(parent)
      expect(result.info.childSessionID).toBe(child)
      expect(result.info.childUserMessageID).toBe(msg)
    })
  })

  test("resolved startupFailure before launch fails queued task without running", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const err = new Error("startup failed")
      let launchCount = 0
      let runCount = 0
      const origRunning = BackgroundTask.transitionToRunning

      try {
        Object.defineProperty(BackgroundTask, "transitionToRunning", {
          value: (claim: Parameters<typeof origRunning>[0]) => {
            runCount++
            return origRunning(claim)
          },
          configurable: true,
          writable: true,
        })

        await expect(
          BackgroundTaskStart.start({
            parentSessionID: parent,
            childSessionID: child,
            childUserMessageID: msg,
            launch: () => {
              launchCount++
            },
            startupFailure: Promise.resolve({ error: err }),
          }),
        ).rejects.toBe(err)

        expect(launchCount).toBe(1)
        expect(runCount).toBe(0)

        const info = BackgroundTask.list({ parentSessionID: parent })
        expect(info).toHaveLength(1)
        expect(info[0].status).toBe("failed")
        expect(info[0].startedAt).toBeUndefined()
        expect(info[0].error?.message).toBe("startup failed")
      } finally {
        Object.defineProperty(BackgroundTask, "transitionToRunning", {
          value: origRunning,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("startupFailure after launch fails queued task and cleans acknowledgement", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const fail = defer<{ error: unknown }>()
      const err = new Error("child failed before open")
      let subscribeCalls = 0
      let unsubCalls = 0
      const removeCalls: string[] = []
      const origSubscribe = Bus.subscribe
      const origRemove = AbortSignal.prototype.removeEventListener

      try {
        Object.defineProperty(Bus, "subscribe", {
          value: (def: Parameters<typeof origSubscribe>[0], cb: Parameters<typeof origSubscribe>[1]) => {
            subscribeCalls++
            const unsub = origSubscribe(def, cb)
            return () => {
              unsubCalls++
              unsub()
            }
          },
          configurable: true,
          writable: true,
        })

        Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
          value: function (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
          ) {
            removeCalls.push(type)
            return origRemove.call(this, type, listener, options)
          },
          configurable: true,
          writable: true,
        })

        const p = BackgroundTaskStart.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {},
          startupFailure: fail.promise,
        })

        fail.resolve({ error: err })

        await expect(p).rejects.toBe(err)
        expect(subscribeCalls).toBe(1)
        expect(unsubCalls).toBe(1)
        expect(removeCalls).toContain("abort")

        const info = BackgroundTask.list({ parentSessionID: parent })
        expect(info).toHaveLength(1)
        expect(info[0].status).toBe("failed")
        expect(info[0].startedAt).toBeUndefined()
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: origSubscribe,
          configurable: true,
          writable: true,
        })
        Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
          value: origRemove,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("late TurnOpen after startupFailure keeps failed state terminal", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const fail = defer<{ error: unknown }>()
      const err = new Error("failed before open")

      const p = BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {},
        startupFailure: fail.promise,
      })

      fail.resolve({ error: err })
      await expect(p).rejects.toBe(err)

      await Bus.publish(Session.Event.TurnOpen, { sessionID: child })
      await Bun.sleep(20)

      const info = BackgroundTask.list({ parentSessionID: parent })
      expect(info).toHaveLength(1)
      expect(info[0].status).toBe("failed")
      expect(info[0].startedAt).toBeUndefined()
      expect(info[0].error?.message).toBe("failed before open")
    })
  })

  test("TurnOpen before late startupFailure keeps running state unchanged", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const fail = defer<{ error: unknown }>()
      const result = await BackgroundTaskStart.start({
        parentSessionID: parent,
        childSessionID: child,
        childUserMessageID: msg,
        launch: () => {
          void Bus.publish(Session.Event.TurnOpen, { sessionID: child })
        },
        startupFailure: fail.promise,
      })

      expect(result.info.status).toBe("running")

      fail.resolve({ error: new Error("late failure") })
      await Bun.sleep(20)

      const info = BackgroundTask.get(result.info.taskID)
      expect(info?.status).toBe("running")
      expect(info?.startedAt).toBeDefined()
      expect(info?.error).toBeUndefined()
    })
  })

  test("synchronous launch throw marks the task failed", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const boom = new TypeError("launch broke")

      await expect(
        BackgroundTaskStart.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            throw boom
          },
        }),
      ).rejects.toThrow("launch broke")

      const info = BackgroundTask.list({ parentSessionID: parent })
      expect(info).toHaveLength(1)
      expect(info[0].status).toBe("failed")
      expect(info[0].error).toEqual({
        name: "TypeError",
        message: "launch broke",
      })
    })
  })
  test("synchronous launch throw rejects with the original error", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      const boom = new RangeError("specific error")

      try {
        await BackgroundTaskStart.start({
          parentSessionID: parent,
          childSessionID: child,
          childUserMessageID: msg,
          launch: () => {
            throw boom
          },
        })
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBe(boom)
      }
    })
  })

  test("launch failure removes the outstanding acknowledgement listener", async () => {
    await using tmp = await tmpdir()
    const parent = sid()
    const child = sid()
    const msg = mid()

    await withInstance(tmp.path, async () => {
      let subscribeCalls = 0
      let unsubCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          subscribeCalls++
          const origUnsub = originalSubscribe(def, cb)
          return () => {
            unsubCalls++
            origUnsub()
          }
        },
        configurable: true,
        writable: true,
      })

      const removeCalls: string[] = []
      const origRemove = AbortSignal.prototype.removeEventListener
      Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
        value: function (type: string, listener: any, options?: any) {
          removeCalls.push(type)
          return origRemove.call(this, type, listener, options)
        },
        configurable: true,
        writable: true,
      })

      const boom = new Error("launch blew up")

      try {
        await expect(
          BackgroundTaskStart.start({
            parentSessionID: parent,
            childSessionID: child,
            childUserMessageID: msg,
            launch: () => {
              throw boom
            },
          }),
        ).rejects.toBe(boom)

        expect(subscribeCalls).toBe(1)
        expect(unsubCalls).toBe(1)
        expect(removeCalls).toContain("abort")

        const info = BackgroundTask.list({ parentSessionID: parent })
        expect(info).toHaveLength(1)
        expect(info[0].status).toBe("failed")
        expect(info[0].error).toEqual({
          name: "Error",
          message: "launch blew up",
        })
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
        Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
          value: origRemove,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("no SessionPrompt import or call exists in production file", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/kilocode/background-task-start.ts"), "utf8")
    expect(src).not.toContain("SessionPrompt")
  })

  test("no completion or result behavior exists in this slice", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/kilocode/background-task-start.ts"), "utf8")
    expect(src).not.toContain("transitionToCompleted")
    expect(src).not.toContain("resultMessageID")
  })
})
