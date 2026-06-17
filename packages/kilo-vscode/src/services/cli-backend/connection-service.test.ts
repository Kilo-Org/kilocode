import { describe, expect, test } from "bun:test"
import { KiloConnectionService } from "./connection-service"

describe("KiloConnectionService viewed sessions", () => {
  test("keeps Agent Manager sessions when sidebar focus changes during a flush", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ focused: string[]; open?: string[] }> = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let max = 0

    ;(service as any).remoteService = { getState: () => ({ enabled: true }) }
    ;(service as any).client = {
      session: {
        viewed: async (input: { focused: string[]; open?: string[] }) => {
          calls.push(input)
          active += 1
          max = Math.max(max, active)
          if (calls.length === 1) await gate
          active -= 1
        },
      },
    }

    service.registerFocused("agent-manager", "am-1")
    service.registerOpen("agent-manager", ["am-1", "am-2"])
    await Bun.sleep(175)
    expect(calls).toEqual([{ focused: ["am-1"], open: ["am-2"] }])

    service.registerFocused("sidebar", "side-1")
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)

    release()
    await Bun.sleep(10)
    expect(max).toBe(1)
    expect(calls[1]).toEqual({ focused: ["am-1", "side-1"], open: ["am-2"] })

    service.unregisterFocused("sidebar")
    await Bun.sleep(175)
    expect(calls[2]).toEqual({ focused: ["am-1"], open: ["am-2"] })
  })
})

describe("KiloConnectionService drainPendingPrompts", () => {
  test("ignores stale NotFoundError replies while draining permissions", async () => {
    const service = new KiloConnectionService({} as any)
    const client = {
      project: {
        list: async () => ({ data: [] }),
      },
      permission: {
        list: async () => ({ data: [{ id: "per_test" }] }),
        reply: async () => ({ error: { name: "NotFoundError", data: { message: "missing" } } }),
      },
      question: {
        list: async () => ({ data: [] }),
      },
      suggestion: {
        list: async () => ({ data: [] }),
      },
      network: {
        list: async () => ({ data: [] }),
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => ["/tmp/workspace"])

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()
  })
})
