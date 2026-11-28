import { describe, expect, test } from "bun:test"
import { dispatchToHandlers } from "../../webview-ui/src/utils/message-dispatch"

describe("dispatchToHandlers", () => {
  test("delivers the message to every registered handler", () => {
    const handlers = new Set<(message: string) => void>()
    const seen: string[] = []
    handlers.add((message) => seen.push(`first:${message}`))
    handlers.add((message) => seen.push(`second:${message}`))

    dispatchToHandlers(handlers, "ping")

    expect(seen).toEqual(["first:ping", "second:ping"])
  })

  test("a throwing handler does not starve handlers registered after it", () => {
    const handlers = new Set<(message: string) => void>()
    const calls: string[] = []
    const errorSpy = console.error
    let logged: unknown
    console.error = (...args: unknown[]) => {
      logged = args
    }

    handlers.add(() => {
      throw new Error("boom")
    })
    handlers.add((message) => calls.push(`survivor:${message}`))

    try {
      expect(() => dispatchToHandlers(handlers, "ping")).not.toThrow()
    } finally {
      console.error = errorSpy
    }

    expect(calls).toEqual(["survivor:ping"])
    expect(logged).toBeDefined()
  })

  test("multiple failing handlers still deliver to every surviving handler", () => {
    const handlers = new Set<(message: number) => void>()
    const calls: number[] = []
    const errorSpy = console.error
    console.error = () => {}

    handlers.add(() => {
      throw new Error("first failure")
    })
    handlers.add((message) => calls.push(message))
    handlers.add(() => {
      throw new Error("second failure")
    })

    try {
      dispatchToHandlers(handlers, 42)
    } finally {
      console.error = errorSpy
    }

    expect(calls).toEqual([42])
  })

  test("an empty handler set is a no-op", () => {
    expect(() => dispatchToHandlers(new Set<(message: string) => void>(), "ping")).not.toThrow()
  })
})
