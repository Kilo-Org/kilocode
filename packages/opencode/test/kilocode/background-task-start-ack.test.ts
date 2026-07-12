import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { SessionID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { BackgroundTaskStartAck } from "../../src/kilocode/background-task-start-ack"
import { tmpdir } from "../fixture/fixture"

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

afterEach(() => Instance.disposeAll())

describe("BackgroundTaskStartAck", () => {
  test("deterministic abort race: signal aborts during Bus.subscribe", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const controller = new AbortController()
    const originalSubscribe = Bus.subscribe

    let unsubCalls = 0
    const fakeUnsub = () => {
      unsubCalls++
    }

    Object.defineProperty(Bus, "subscribe", {
      value: (def: any, cb: any) => {
        controller.abort()
        return fakeUnsub
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

    try {
      const p = BackgroundTaskStartAck.wait({ sessionID: target, signal: controller.signal })
      await expect(p).rejects.toThrow("Aborted")
      expect(unsubCalls).toBe(1)
      expect(removeCalls).toContain("abort")
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

  test("unrelated session events do not call unsubscribe or settle the wait", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const other = sid()

    await withInstance(tmp.path, async () => {
      let unsubCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          const origUnsub = originalSubscribe(def, cb)
          return () => {
            unsubCalls++
            origUnsub()
          }
        },
        configurable: true,
        writable: true,
      })

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target })

        await Bun.sleep(10)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: other })
        await Bun.sleep(20)

        expect(unsubCalls).toBe(0)

        const race = await Promise.race([
          p.then(() => "resolved" as const),
          Bun.sleep(50).then(() => "timeout" as const),
        ])
        expect(race).toBe("timeout")
        expect(unsubCalls).toBe(0)
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("unsubscribe called exactly once after matching TurnOpen", async () => {
    await using tmp = await tmpdir()
    const target = sid()

    await withInstance(tmp.path, async () => {
      let unsubCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          const origUnsub = originalSubscribe(def, cb)
          return () => {
            unsubCalls++
            origUnsub()
          }
        },
        configurable: true,
        writable: true,
      })

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target })

        await Bun.sleep(10)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: target })
        await Bun.sleep(20)

        await p
        expect(unsubCalls).toBe(1)
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("unsubscribe called exactly once after abort", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const controller = new AbortController()

    await withInstance(tmp.path, async () => {
      let unsubCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          const origUnsub = originalSubscribe(def, cb)
          return () => {
            unsubCalls++
            origUnsub()
          }
        },
        configurable: true,
        writable: true,
      })

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target, signal: controller.signal })

        await Bun.sleep(10)
        controller.abort()

        await expect(p).rejects.toThrow("Aborted")
        expect(unsubCalls).toBe(1)
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("removeEventListener called after successful resolution", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const controller = new AbortController()

    await withInstance(tmp.path, async () => {
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

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target, signal: controller.signal })

        await Bun.sleep(10)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: target })
        await Bun.sleep(20)

        await p
        expect(removeCalls).toContain("abort")
      } finally {
        Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
          value: origRemove,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("removeEventListener called after abort", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const controller = new AbortController()

    await withInstance(tmp.path, async () => {
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

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target, signal: controller.signal })

        await Bun.sleep(10)
        controller.abort()

        await expect(p).rejects.toThrow("Aborted")
        expect(removeCalls).toContain("abort")
      } finally {
        Object.defineProperty(AbortSignal.prototype, "removeEventListener", {
          value: origRemove,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("repeated matching events cannot invoke cleanup more than once", async () => {
    await using tmp = await tmpdir()
    const target = sid()

    await withInstance(tmp.path, async () => {
      let unsubCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          const origUnsub = originalSubscribe(def, cb)
          return () => {
            unsubCalls++
            origUnsub()
          }
        },
        configurable: true,
        writable: true,
      })

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target })

        await Bun.sleep(10)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: target })
        await Bun.sleep(20)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: target })
        await Bun.sleep(20)
        await Bus.publish(Session.Event.TurnOpen, { sessionID: target })
        await Bun.sleep(40)

        await p
        expect(unsubCalls).toBe(1)
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("already-aborted signal does not call Bus.subscribe", async () => {
    await using tmp = await tmpdir()
    const target = sid()
    const controller = new AbortController()
    controller.abort()

    await withInstance(tmp.path, async () => {
      let subscribeCalls = 0
      const originalSubscribe = Bus.subscribe

      Object.defineProperty(Bus, "subscribe", {
        value: (def: any, cb: any) => {
          subscribeCalls++
          return originalSubscribe(def, cb)
        },
        configurable: true,
        writable: true,
      })

      try {
        const p = BackgroundTaskStartAck.wait({ sessionID: target, signal: controller.signal })
        await expect(p).rejects.toThrow("Aborted")
        expect(subscribeCalls).toBe(0)
      } finally {
        Object.defineProperty(Bus, "subscribe", {
          value: originalSubscribe,
          configurable: true,
          writable: true,
        })
      }
    })
  })

  test("production file contains no SessionPrompt or background-task registry import", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/kilocode/background-task-start-ack.ts"), "utf8")
    expect(src).not.toContain("SessionPrompt")
    expect(src).not.toContain("background-task")
    expect(src).not.toMatch(/from.*background-task["']/)
  })
})
