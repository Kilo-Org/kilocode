import { describe, expect, it } from "bun:test"
import type { ProviderUsage, ProviderUsageWindow } from "@kilocode/sdk/v2/client"
import { formatWindow, windowLabel, windowProgress } from "@kilocode/kilo-gateway/provider-usage"

const { KiloProvider } = await import("../../src/KiloProvider")

const data: ProviderUsage = {
  generatedAt: "2026-06-19T00:00:00.000Z",
  items: [],
}

type Internals = {
  cachedProviderUsageMessage: unknown
  fetchAndSendProviderUsage: (force?: boolean) => Promise<void>
  reloadAfterAuthChange: () => Promise<void>
  postMessage: (message: unknown) => void
}

type UsageClient = {
  get: (input: { directory?: string }) => Promise<unknown>
  refresh: (input: { directory?: string }) => Promise<unknown>
}

// Answers any SDK endpoint outside the fake usage client with a benign empty
// response, so tests never have to mirror KiloProvider's internal fetcher list.
const benign = (value: unknown): unknown =>
  typeof value === "function"
    ? value
    : new Proxy(() => {}, {
        get: (_, prop) =>
          prop === "then" ? undefined : benign((value as Record<PropertyKey, unknown> | undefined)?.[prop]),
        apply: () => Promise.resolve({ data: [] }),
      })

function bridge(usage: UsageClient) {
  const messages: unknown[] = []
  const provider = new KiloProvider(
    {} as never,
    { getClient: () => benign({ kilocode: { providerUsage: usage } }) } as never,
    undefined,
    { projectDirectory: "/repo" },
  )
  const internal = provider as unknown as Internals
  internal.postMessage = (message) => messages.push(message)
  return { provider, internal, messages }
}

const usageMessages = (messages: unknown[]) =>
  messages.filter((message) => (message as { type?: string }).type === "providerUsageLoaded")

describe("provider usage presentation", () => {
  const window = (value: Partial<ProviderUsageWindow>): ProviderUsageWindow => ({
    id: "quota",
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

  it("composes window labels from structured periods instead of wire strings", () => {
    expect(windowLabel(window({ resource: "subscription", period: { unit: "month", value: 1 } }))).toBe("Monthly quota")
    expect(windowLabel(window({ resource: "subscription", period: { unit: "day", value: 3 } }))).toBe("3-day quota")
    expect(windowLabel(window({ period: { unit: "hour", value: 5 } }))).toBe("Shared · 5-hour quota")
    expect(windowLabel(window({ period: { unit: "week", value: 1 } }))).toBe("Shared · Weekly quota")
    expect(windowLabel(window({ resource: "image" }))).toBe("image · Quota")
  })
})

describe("KiloProvider provider usage bridge", () => {
  it("uses cache-aware GET on open and forced POST for refresh", async () => {
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
    expect(internal.cachedProviderUsageMessage).toEqual({ type: "providerUsageLoaded", data })
  })

  it("surfaces a failed forced refresh alongside the cached data", async () => {
    const { internal, messages } = bridge({
      get: async () => ({ data }),
      refresh: async () => ({ error: { _tag: "ServiceUnavailable" } }),
    })

    internal.cachedProviderUsageMessage = { type: "providerUsageLoaded", data }
    await internal.fetchAndSendProviderUsage(true)

    expect(messages).toEqual([{ type: "providerUsageLoaded", data, error: "Provider usage could not be refreshed." }])
  })

  it("posts a terminal loading error when the backend has no cached response", async () => {
    const { internal, messages } = bridge({
      get: async () => ({ error: { _tag: "ServiceUnavailable" } }),
      refresh: async () => ({ error: { _tag: "ServiceUnavailable" } }),
    })

    await internal.fetchAndSendProviderUsage()

    expect(messages).toEqual([{ type: "providerUsageLoaded", error: "Provider usage could not be loaded." }])
  })

  it("invalidates cached usage without reloading on auth change", async () => {
    const requests: unknown[] = []
    const { internal, messages } = bridge({
      get: async (input) => {
        requests.push(input)
        return { data: { generatedAt: "a", items: [] } }
      },
      refresh: async () => ({ data }),
    })

    await internal.fetchAndSendProviderUsage()
    await internal.reloadAfterAuthChange()

    expect(usageMessages(messages)).toEqual([
      { type: "providerUsageLoaded", data: { generatedAt: "a", items: [] } },
      { type: "providerUsageLoaded", reset: true },
    ])
    expect(requests).toHaveLength(1)
    expect(internal.cachedProviderUsageMessage).toBeNull()
  })

  it("resets usage without fetching when auth changes before the profile is opened", async () => {
    const requests: unknown[] = []
    const { internal, messages } = bridge({
      get: async () => ({ data }),
      refresh: async (input) => {
        requests.push(input)
        return { data }
      },
    })

    await internal.reloadAfterAuthChange()

    expect(requests).toEqual([])
    expect(usageMessages(messages)).toEqual([{ type: "providerUsageLoaded", reset: true }])
  })

  it("drops an in-flight usage response from the previous account", async () => {
    let release!: (value: { data: ProviderUsage }) => void
    const first = new Promise<{ data: ProviderUsage }>((resolve) => (release = resolve))
    const calls: unknown[] = []
    const { internal, messages } = bridge({
      get: (input) => {
        calls.push(input)
        return first
      },
      refresh: async () => ({ data }),
    })

    const hung = internal.fetchAndSendProviderUsage()
    await internal.reloadAfterAuthChange()
    release({ data: { generatedAt: "a", items: [] } })
    await hung

    expect(usageMessages(messages)).toEqual([{ type: "providerUsageLoaded", reset: true }])
    expect(calls).toHaveLength(1)
    expect(internal.cachedProviderUsageMessage).toBeNull()
  })

  it("invalidates cached usage without fetching when the workspace directory changes", async () => {
    const requests: unknown[] = []
    const { provider, internal, messages } = bridge({
      get: async (input) => {
        requests.push(input)
        return { data }
      },
      refresh: async () => ({ data }),
    })

    await internal.fetchAndSendProviderUsage()
    provider.setProjectDirectory("/other")

    expect(requests).toHaveLength(1)
    expect(internal.cachedProviderUsageMessage).toBeNull()
    expect(messages).toContainEqual({ type: "workspaceDirectoryChanged", directory: "/other" })
  })
})
