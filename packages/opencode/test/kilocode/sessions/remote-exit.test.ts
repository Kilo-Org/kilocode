import { afterEach, describe, expect, test } from "bun:test"
import { RemoteExit } from "../../../src/kilo-sessions/remote-exit"

describe("RemoteExit", () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  test("active unregister clears its callback", () => {
    const callback = async () => {}
    const unregister = RemoteExit.register(callback)
    cleanups.push(unregister)

    expect(RemoteExit.get()).toBe(callback)
    unregister()
    expect(RemoteExit.get()).toBeUndefined()
  })

  test("stale unregister preserves a different callback replacement", () => {
    const first = RemoteExit.register(async () => {})
    const replacement = async () => {}
    const second = RemoteExit.register(replacement)
    cleanups.push(first, second)

    first()
    expect(RemoteExit.get()).toBe(replacement)
  })

  test("stale unregister preserves a same-callback replacement", () => {
    const callback = async () => {}
    const first = RemoteExit.register(callback)
    const second = RemoteExit.register(callback)
    cleanups.push(first, second)

    first()
    expect(RemoteExit.get()).toBe(callback)
    second()
    expect(RemoteExit.get()).toBeUndefined()
  })
})
