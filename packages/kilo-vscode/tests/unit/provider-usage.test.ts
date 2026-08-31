import { describe, expect, it } from "bun:test"
import type { ProviderUsage, ProviderUsageWindow } from "@kilocode/sdk/v2/client"
import { formatWindow, windowLabel, windowProgress } from "@kilocode/kilo-gateway/provider-usage"
import {
  handleLogin,
  handleLogout,
  handleSetOrganization,
  type AuthContext,
} from "../../src/kilo-provider/handlers/auth"

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

function bridge(usage: UsageClient, opts?: { startup?: Promise<void>; state?: string }) {
  const messages: unknown[] = []
  const connections: string[] = []
  let ready = !opts?.startup
  const provider = new KiloProvider(
    {} as never,
    {
      getConnectionState: () => opts?.state ?? "disconnected",
      connect: async (directory: string) => {
        connections.push(directory)
        await opts?.startup
        ready = true
      },
      getClient: () => {
        if (!ready || opts?.state === "error") throw new Error("Not connected")
        return benign({ kilocode: { providerUsage: usage } })
      },
    } as never,
    undefined,
    { projectDirectory: "/repo" },
  )
  const internal = provider as unknown as Internals
  internal.postMessage = (message) => messages.push(message)
  return { provider, internal, messages, connections }
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

describe("profile auth usage", () => {
  it.each([
    ["login", (ctx: AuthContext) => handleLogin(ctx, 1, () => 1)],
    ["logout", handleLogout],
    ["organization switch", (ctx: AuthContext) => handleSetOrganization(ctx, "org")],
  ] as const)("%s refreshes the initiating profile after disposal finishes", async (_, run) => {
    const started = Promise.withResolvers<void>()
    const disposed = Promise.withResolvers<void>()
    const calls: string[] = []
    const ctx: AuthContext = {
      client: benign({}) as AuthContext["client"],
      postMessage: () => {},
      getWorkspaceDirectory: () => "/repo",
      invalidateProviderUsage: () => void calls.push("reset"),
      disposeGlobal: async () => {
        calls.push("dispose")
        started.resolve()
        await disposed.promise
      },
      fetchAndSendProviderUsage: async () => void calls.push("usage"),
      fetchAndSendProviders: async () => {},
      fetchAndSendAgents: async () => {},
      fetchAndSendSpeechToTextModels: async () => {},
    }

    const pending = run(ctx)
    await started.promise
    expect(calls).toEqual(["reset", "dispose"])
    disposed.resolve()
    await pending
    expect(calls).toEqual(["reset", "dispose", "usage"])
  })
})

describe("KiloProvider provider usage bridge", () => {
  it.each([false, true])("waits for startup before requesting usage (force=%s)", async (force) => {
    const startup = Promise.withResolvers<void>()
    const requests: string[] = []
    const { internal, messages, connections } = bridge(
      {
        get: async () => {
          requests.push("GET")
          return { data }
        },
        refresh: async () => {
          requests.push("POST")
          return { data }
        },
      },
      { startup: startup.promise },
    )

    const pending = internal.fetchAndSendProviderUsage(force)
    expect(messages).toEqual([])
    expect(requests).toEqual([])
    startup.resolve()
    await pending

    expect(connections).toEqual(["/repo"])
    expect(requests).toEqual([force ? "POST" : "GET"])
    expect(messages).toEqual([{ type: "providerUsageLoaded", data }])
  })

  it("does not load usage after the project changes while waiting for startup", async () => {
    const startup = Promise.withResolvers<void>()
    const requests: unknown[] = []
    const { provider, internal, messages } = bridge(
      {
        get: async (input) => {
          requests.push(input)
          return { data }
        },
        refresh: async () => ({ data }),
      },
      { startup: startup.promise },
    )

    const pending = internal.fetchAndSendProviderUsage()
    provider.setProjectDirectory("/other")
    startup.resolve()
    await pending

    expect(requests).toEqual([])
    expect(usageMessages(messages)).toEqual([])
  })

  it("reports a terminal error when the backend cannot connect", async () => {
    const { internal, messages } = bridge(
      { get: async () => ({ data }), refresh: async () => ({ data }) },
      { startup: Promise.reject(new Error("startup failed")) },
    )

    await internal.fetchAndSendProviderUsage()

    expect(messages).toEqual([{ type: "providerUsageLoaded", error: "Provider usage could not be loaded." }])
  })

  it("does not start a backend from the error state", async () => {
    const { internal, messages, connections } = bridge(
      { get: async () => ({ data }), refresh: async () => ({ data }) },
      { state: "error" },
    )

    await internal.fetchAndSendProviderUsage()

    expect(connections).toEqual([])
    expect(messages).toEqual([{ type: "providerUsageLoaded", error: "Provider usage could not be loaded." }])
  })

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

  it("invalidates usage without background GET or POST requests on a disposal broadcast", async () => {
    const requests: string[] = []
    const { internal, messages } = bridge({
      get: async () => {
        requests.push("GET")
        return { data }
      },
      refresh: async () => {
        requests.push("POST")
        return { data }
      },
    })
    internal.cachedProviderUsageMessage = { type: "providerUsageLoaded", data }

    await internal.reloadAfterAuthChange()

    expect(requests).toEqual([])
    expect(usageMessages(messages)).toEqual([{ type: "providerUsageLoaded", reset: true }])
    expect(internal.cachedProviderUsageMessage).toBeNull()
  })

  it("drops an in-flight usage response from the previous account", async () => {
    const response = Promise.withResolvers<{ data: ProviderUsage }>()
    const started = Promise.withResolvers<void>()
    const calls: unknown[] = []
    const { internal, messages } = bridge({
      get: (input) => {
        calls.push(input)
        started.resolve()
        return response.promise
      },
      refresh: async () => ({ data }),
    })

    const pending = internal.fetchAndSendProviderUsage()
    await started.promise
    await internal.reloadAfterAuthChange()
    response.resolve({ data: { generatedAt: "stale", items: [] } })
    await pending

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
