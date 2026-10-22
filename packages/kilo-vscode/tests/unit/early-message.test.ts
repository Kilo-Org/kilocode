import { describe, expect, it } from "bun:test"
import { routeEarlyMessage } from "../../src/kilo-provider/early-message"

type Ctx = Parameters<typeof routeEarlyMessage>[1]

function context(copied: string[], posted: unknown[], fail = false) {
  return {
    copy: async (text: string) => {
      if (fail) throw new Error("clipboard unavailable")
      copied.push(text)
    },
    post: (message: unknown) => posted.push(message),
  } as Ctx
}

describe("routeEarlyMessage clipboard handling", () => {
  it("routes clipboard text to the host", async () => {
    const copied: string[] = []
    const posted: unknown[] = []

    const handled = await routeEarlyMessage(
      { type: "copyToClipboard", id: "copy-1", text: "message text" },
      context(copied, posted),
    )

    expect(handled).toBe(true)
    expect(copied).toEqual(["message text"])
    expect(posted).toEqual([{ type: "clipboardWriteResult", id: "copy-1", ok: true }])
  })

  it("reports host clipboard failures", async () => {
    const copied: string[] = []
    const posted: unknown[] = []

    const handled = await routeEarlyMessage(
      { type: "copyToClipboard", id: "copy-2", text: "message text" },
      context(copied, posted, true),
    )

    expect(handled).toBe(true)
    expect(copied).toEqual([])
    expect(posted).toEqual([{ type: "clipboardWriteResult", id: "copy-2", ok: false, error: "clipboard unavailable" }])
  })
})

describe("routeEarlyMessage activity", () => {
  it("forwards authoritative webview presentation state without interpreting session events", async () => {
    const calls: unknown[] = []
    const ctx = { activity: (state: unknown) => calls.push(state) } as Ctx
    for (const state of ["busy", "waiting", "done", "scheduled", "error", "idle"]) {
      expect(await routeEarlyMessage({ type: "sessionActivity", state }, ctx)).toBe(true)
    }
    expect(calls).toEqual(["busy", "waiting", "done", "scheduled", "error", "idle"])
  })
})
