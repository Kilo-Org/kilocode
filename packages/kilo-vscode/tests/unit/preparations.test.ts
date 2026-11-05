import { describe, expect, it } from "bun:test"
import { Preparations } from "../../src/kilo-provider/preparations"

describe("Preparations", () => {
  it("lets two same-session sends both complete", async () => {
    const prep = new Preparations()
    const gate = Promise.withResolvers<void>()
    const send = async (label: string) => {
      const controller = prep.track("s")
      try {
        await gate.promise
        if (controller.signal.aborted) return "dropped"
        return label
      } finally {
        prep.finish("s", controller)
      }
    }

    const pending = Promise.all([send("first"), send("second")])
    gate.resolve()
    expect(await pending).toEqual(["first", "second"])
    prep.cancel("s")
    expect(prep.track("s").signal.aborted).toBe(false)
  })

  it("untracks only the caller that finished", () => {
    const prep = new Preparations()
    const first = prep.track("s")
    const second = prep.track("s")
    expect(first.signal.aborted).toBe(false)
    prep.finish("s", first)
    prep.cancel("s")
    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(true)
  })

  it("stops every pending send for that session and leaves other sessions", async () => {
    const prep = new Preparations()
    const gate = Promise.withResolvers<void>()
    const send = (sid: string) => {
      const controller = prep.track(sid)
      const done = (async () => {
        try {
          await gate.promise
          if (controller.signal.aborted) return "cancelled"
          return "sent"
        } catch (error) {
          if (controller.signal.aborted) return "cancelled"
          throw error
        } finally {
          prep.finish(sid, controller)
        }
      })()
      return { controller, done }
    }

    const first = send("s")
    const second = send("s")
    const other = send("t")
    first.controller.signal.addEventListener("abort", () => prep.finish("s", second.controller))
    prep.cancel("s")
    gate.resolve()

    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(true)
    expect(other.controller.signal.aborted).toBe(false)
    expect(await first.done).toBe("cancelled")
    expect(await second.done).toBe("cancelled")
    expect(await other.done).toBe("sent")
  })

  it("aborts every session on dispose and forgets them", () => {
    const prep = new Preparations()
    const first = prep.track("s")
    const second = prep.track("t")
    prep.dispose()
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)

    prep.finish("s", first)
    prep.cancel("s")
    const next = prep.track("s")
    expect(next.signal.aborted).toBe(false)
    prep.dispose()
    expect(next.signal.aborted).toBe(true)
    prep.dispose()
  })
})
