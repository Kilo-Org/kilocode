import { describe, expect, test } from "bun:test"
import { createSandboxStatus, indicator } from "../../src/kilocode/sandbox"

const status = (enabled: boolean) => ({
  directory: "/repo",
  enabled,
  available: true,
  network: !enabled,
  version: 1,
})

describe("sandbox TUI", () => {
  test("shows an indicator only for an active sandbox", () => {
    expect(
      indicator({ directory: "/repo", enabled: true, available: true, network: true, version: 1 }),
    ).toBe("◆ Sandbox on")
    expect(
      indicator({ directory: "/repo", enabled: true, available: false, network: false, version: 1 }),
    ).toBe("◆ Sandbox on")
    expect(
      indicator({ directory: "/repo", enabled: false, available: true, network: false, version: 2 }),
    ).toBeUndefined()
    expect(
      indicator({
        directory: "/repo",
        enabled: false,
        available: false,
        reason: "unavailable",
        network: false,
        version: 0,
      }),
    ).toBeUndefined()
  })

  test("shows no indicator without a status", () => {
    expect(indicator()).toBeUndefined()
  })

  test("keeps the newest status when two reads resolve out of order", async () => {
    const resolvers: ((value: ReturnType<typeof status>) => void)[] = []
    const state = createSandboxStatus({
      stored: () => "/repo",
      read: () => new Promise((resolve) => resolvers.push(resolve)),
      write: () => Promise.reject(new Error("unexpected toggle")),
    })

    const first = state.load("ses_order")
    const second = state.load("ses_order")
    resolvers[1](status(true))
    await second
    resolvers[0](status(false))
    await first

    expect(state.status("ses_order")?.enabled).toBe(true)
  })

  test("uses the creation directory while the store lacks a created session", async () => {
    const locations: unknown[] = []
    const state = createSandboxStatus({
      stored: () => undefined,
      read: () => Promise.reject(new Error("unexpected read")),
      write: (_sessionID, location) => {
        locations.push(location)
        return Promise.resolve(status(true))
      },
    })

    state.remember("ses_created", "/created")
    expect(await state.toggle("ses_created")).toMatchObject({ enabled: true })
    expect(locations).toEqual([{ location: { directory: "/created" } }])
  })

  test("drops the creation directory once the store supplies the session", async () => {
    const locations: unknown[] = []
    let stored: string | undefined
    const state = createSandboxStatus({
      stored: () => stored,
      read: (_sessionID, location) => {
        locations.push(location)
        return Promise.resolve(status(false))
      },
      write: () => Promise.reject(new Error("unexpected toggle")),
    })

    state.remember("ses_moved", "/created")
    stored = "/moved"
    state.forget()
    // The store forgets the session later, as eviction or a transient gap would; the creation directory is gone.
    stored = undefined
    await state.load("ses_moved")

    expect(locations).toEqual([undefined])
  })
})
