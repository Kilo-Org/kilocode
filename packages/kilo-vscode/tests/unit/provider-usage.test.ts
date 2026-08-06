import { describe, expect, it } from "bun:test"
import type { ProviderUsage, ProviderUsageWindow } from "@kilocode/sdk/v2/client"
import { formatWindow, windowProgress } from "@kilocode/kilo-gateway/provider-usage"

const { KiloProvider } = await import("../../src/KiloProvider")

const data: ProviderUsage = {
  generatedAt: "2026-06-19T00:00:00.000Z",
  items: [],
}

type Internals = {
  providerUsageRequested: boolean
  cachedProviderUsageMessage: unknown
  fetchAndSendProviderUsage: (force?: boolean) => Promise<void>
  handleProfileDataMessage: (message: { type: string }) => Promise<boolean>
  reloadAfterAuthChange: () => Promise<void>
  postMessage: (message: unknown) => void
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
}

type UsageClient = {
  get: (input: { directory?: string }) => Promise<unknown>
  refresh?: (input: { directory?: string }) => Promise<unknown>
}

function bridge(usage: UsageClient) {
  const messages: unknown[] = []
  const provider = new KiloProvider(
    {} as never,
    { getClient: () => ({ kilocode: { providerUsage: usage } }) } as never,
    undefined,
    { projectDirectory: "/repo" },
  )
  const internal = provider as unknown as Internals
  internal.postMessage = (message) => messages.push(message)
  return { internal, messages }
}

describe("provider usage presentation", () => {
  const window = (value: Partial<ProviderUsageWindow>): ProviderUsageWindow => ({
    id: "quota",
    label: "Quota",
    resource: "general",
    unit: "percent",
    orientation: "remaining_percent",
    state: "active",
    ...value,
  })

  it("formats used and remaining orientations without provider branching", () => {
    expect(formatWindow(window({ remaining: 75, limit: 100 }))).toBe("75% remaining")
    expect(formatWindow(window({ orientation: "used_percent", used: 25, limit: 100 }))).toBe("25% used")
    expect(windowProgress(window({ remaining: 75, limit: 100 }))).toBe(25)
  })

  it("keeps known zero distinct from unknown and preserves contract states", () => {
    expect(formatWindow(window({ remaining: 0, limit: 100, state: "exhausted" }))).toBe("0% remaining")
    expect(formatWindow(window({ state: "unknown" }))).toBe("Unknown")
    expect(formatWindow(window({ state: "unlimited" }))).toBe("Unlimited")
    expect(formatWindow(window({ state: "not_in_plan" }))).toBe("Not in plan")
  })
})

describe("KiloProvider provider usage bridge", () => {
  it("uses cache-aware GET and explicit refresh POST", async () => {
    const get: Array<{ directory?: string }> = []
    const refresh: Array<{ directory?: string }> = []
    const { internal, messages } = bridge({
      get: async (input) => {
        get.push(input)
        return { data }
      },
      refresh: async (input) => {
        refresh.push(input)
        return { data }
      },
    })

    await internal.fetchAndSendProviderUsage()
    await internal.fetchAndSendProviderUsage(true)

    expect(get).toEqual([{ directory: "/repo" }])
    expect(refresh).toEqual([{ directory: "/repo" }])
    expect(messages).toEqual([
      { type: "providerUsageLoaded", data },
      { type: "providerUsageLoaded", data },
    ])
    expect(internal.providerUsageRequested).toBe(true)
    expect(internal.cachedProviderUsageMessage).toEqual({ type: "providerUsageLoaded", data })
  })

  it("surfaces a failed forced refresh alongside the cached data", async () => {
    const { internal, messages } = bridge({
      get: async () => ({ data }),
      refresh: async () => ({ error: { _tag: "ServiceUnavailable" } }),
    })

    await internal.fetchAndSendProviderUsage()
    await internal.fetchAndSendProviderUsage(true)

    expect(messages).toEqual([
      { type: "providerUsageLoaded", data },
      { type: "providerUsageLoaded", data, error: "Provider usage could not be refreshed." },
    ])
  })

  it("posts a terminal loading error when the backend has no cached response", async () => {
    const { internal, messages } = bridge({
      get: async () => ({ error: { _tag: "ServiceUnavailable" } }),
    })

    await internal.fetchAndSendProviderUsage()

    expect(messages).toEqual([{ type: "providerUsageLoaded", error: "Provider usage could not be loaded." }])
  })

  it("refreshes usage after auth invalidation only after the profile requested it", async () => {
    const provider = new KiloProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    let usage = 0
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendProviders = async () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendIndexingStatus = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.fetchAndSendProviderUsage = async () => {
      usage++
    }

    await internal.reloadAfterAuthChange()
    expect(usage).toBe(0)
    internal.providerUsageRequested = true
    await internal.reloadAfterAuthChange()
    expect(usage).toBe(1)
  })

  it("releases the background refresh latch when the profile view unmounts", async () => {
    const { internal } = bridge({ get: async () => ({ data }) })

    await internal.fetchAndSendProviderUsage()
    expect(internal.providerUsageRequested).toBe(true)

    expect(await internal.handleProfileDataMessage({ type: "releaseProviderUsage" })).toBe(true)
    expect(internal.providerUsageRequested).toBe(false)
  })
})
