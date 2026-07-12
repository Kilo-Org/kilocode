import { describe, expect, test } from "bun:test"
import { ForegroundTask } from "../../src/kilocode/foreground-task"
import { SessionID } from "../../src/session/schema"

describe("kilocode foreground task registry", () => {
  test("register adds an entry and interrupt removes it exactly once", () => {
    const id = SessionID.make("foreground-task-a")
    let calls = 0
    const dispose = ForegroundTask.register(id, {
      interrupt() {
        calls++
      },
    })

    expect(ForegroundTask.has(id)).toBe(true)
    expect(ForegroundTask.interrupt(id)).toBe(true)
    expect(calls).toBe(1)
    expect(ForegroundTask.has(id)).toBe(false)
    expect(ForegroundTask.interrupt(id)).toBe(false)

    dispose()
    expect(ForegroundTask.has(id)).toBe(false)
  })

  test("disposer removes only its own entry", () => {
    const id = SessionID.make("foreground-task-b")
    const old = ForegroundTask.register(id, {
      interrupt() {},
    })

    expect(ForegroundTask.interrupt(id)).toBe(true)

    const next = ForegroundTask.register(id, {
      interrupt() {},
    })

    old()
    expect(ForegroundTask.has(id)).toBe(true)

    next()
    expect(ForegroundTask.has(id)).toBe(false)
  })

  test("duplicate active registration is rejected", () => {
    const id = SessionID.make("foreground-task-c")
    const dispose = ForegroundTask.register(id, {
      interrupt() {},
    })

    expect(() =>
      ForegroundTask.register(id, {
        interrupt() {},
      }),
    ).toThrow(`Foreground task already registered for session ${id}`)

    dispose()
  })

  test("interrupt on an absent entry returns false", () => {
    const id = SessionID.make("foreground-task-missing")
    expect(ForegroundTask.interrupt(id)).toBe(false)
    expect(ForegroundTask.has(id)).toBe(false)
  })
})
