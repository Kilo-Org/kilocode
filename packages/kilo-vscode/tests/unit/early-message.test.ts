import { describe, expect, it } from "bun:test"
import { routeEarlyMessage } from "../../src/kilo-provider/early-message"

type Ctx = Parameters<typeof routeEarlyMessage>[1]

function context(copied: string[]) {
  return {
    copy: async (text: string) => {
      copied.push(text)
    },
  } as Ctx
}

describe("routeEarlyMessage clipboard handling", () => {
  it("routes clipboard text to the host", async () => {
    const copied: string[] = []

    const handled = await routeEarlyMessage(
      { type: "agentManager.copyToClipboard", text: "message text" },
      context(copied),
    )

    expect(handled).toBe(true)
    expect(copied).toEqual(["message text"])
  })

  it("consumes invalid clipboard text without writing it", async () => {
    const copied: string[] = []

    const handled = await routeEarlyMessage({ type: "agentManager.copyToClipboard", text: undefined }, context(copied))

    expect(handled).toBe(true)
    expect(copied).toEqual([])
  })
})
