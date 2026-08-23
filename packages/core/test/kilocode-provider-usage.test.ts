import { describe, expect, mock, setSystemTime } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { Catalog } from "../src/catalog"
import { Credential } from "../src/credential"
import { Integration } from "../src/integration"
import { ProviderUsage } from "../src/kilocode/provider-usage"
import { PluginV2 } from "../src/plugin"
import { ProviderV2 } from "../src/provider"
import { testEffect } from "./lib/effect"

const provider = ProviderV2.ID.make("minimax-coding-plan")
const chinaProvider = ProviderV2.ID.make("minimax-cn-coding-plan")
const integration = Integration.ID.make("minimax-coding-plan")
const chinaIntegration = Integration.ID.make("minimax-cn-coding-plan")
const kilo = Integration.ID.make("kilo")

type CatalogInput = {
  apiKey?: string
  setting?: string
  header?: string
  headerName?: string
  organization?: string | (() => string | undefined)
  china?: boolean
}

const catalog = (input?: CatalogInput) => {
  const providers = () => {
    const organization = typeof input?.organization === "function" ? input.organization() : input?.organization
    const info = ProviderV2.Info.make({
      id: provider,
      name: "MiniMax Global",
      api: { type: "native", settings: input?.setting ? { apiKey: input.setting } : {} },
      request: {
        headers: input?.header ? { [input.headerName ?? "x-api-key"]: input.header } : {},
        body: input?.apiKey ? { apiKey: input.apiKey } : {},
      },
    })
    const kiloInfo = ProviderV2.Info.make({
      id: ProviderV2.ID.kilo,
      name: "Kilo",
      api: { type: "native", settings: {} },
      request: { headers: {}, body: organization ? { kilocodeOrganizationId: organization } : {} },
    })
    const china = ProviderV2.Info.make({
      id: chinaProvider,
      name: "MiniMax China",
      api: { type: "native", settings: {} },
      request: { headers: {}, body: {} },
    })
    return input?.china ? [info, china, kiloInfo] : [info, kiloInfo]
  }
  return Layer.mock(Catalog.Service)({
    provider: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.sync(providers),
      available: () => Effect.sync(providers),
    },
    model: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
      default: () => Effect.succeed(undefined),
      small: () => Effect.succeed(undefined),
    },
  })
}

type DirectInput = string | ((id: Integration.ID) => string | undefined) | undefined

const directValue = (input: DirectInput, id: Integration.ID) => (typeof input === "function" ? input(id) : input)

const connections = (input: DirectInput, accountID?: string, failure?: () => "global" | "china" | "kilo" | undefined) =>
  Layer.mock(Integration.Service)({
    connection: {
      active: (id) =>
        Effect.sync(() => {
          const direct = directValue(input, id)
          return id === kilo || ((id === integration || id === chinaIntegration) && direct)
            ? {
                type: "credential" as const,
                id: Credential.ID.make(
                  id === kilo ? "cred_kilo" : id === chinaIntegration ? "cred_direct_cn" : "cred_direct",
                ),
                label: "test",
              }
            : undefined
        }),
      resolve: (connection) =>
        Effect.suspend(() => {
          const target =
            connection.type === "credential" && connection.id === "cred_direct_cn" ? chinaIntegration : integration
          const direct = directValue(input, target)
          const kind =
            connection.type === "credential" && connection.id === "cred_kilo"
              ? "kilo"
              : target === chinaIntegration
                ? "china"
                : "global"
          if (failure?.() === kind)
            return Effect.fail(new Integration.AuthorizationError({ cause: `${kind} credential failure` }))
          return Effect.succeed(
            kind === "kilo"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("oauth"),
                  access: "cloud-token",
                  refresh: "cloud-refresh",
                  expires: Date.now() + 60_000,
                  metadata: accountID ? { accountID } : undefined,
                })
              : direct
                ? Credential.Key.make({ type: "key", key: direct })
                : undefined,
          )
        }),
      key: () => Effect.void,
      oauth: () => Effect.die("unused"),
      update: () => Effect.void,
      remove: () => Effect.void,
    },
    attempt: {
      status: () => Effect.die("unused"),
      complete: () => Effect.void,
      cancel: () => Effect.void,
    },
  })

const native = (remaining: number) =>
  Response.json({
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: "general",
        current_interval_remaining_percent: remaining,
        current_interval_status: 1,
      },
    ],
  })

const subscription = {
  id: "byteplus-plan",
  planId: "byteplus-coding-plan-team-lite",
  planName: "BytePlus Coding Plan Lite",
  providerName: "BytePlus",
  providerId: "byteplus-coding",
  canQueryUsage: true,
  hasInstalledByokKey: true,
  status: "active" as const,
  cancelAtPeriodEnd: false,
}

const byok = {
  id: "managed-byteplus",
  provider_id: "byteplus-coding",
  management_source: "coding_plan" as const,
  is_enabled: true,
}

const transport = (calls: { direct: number; cloud: number }, remaining = 80) =>
  Layer.succeed(ProviderUsage.Transport, {
    fetch: mock(() => {
      calls.direct++
      return Promise.resolve(native(remaining))
    }) as unknown as typeof fetch,
    plans: async () => {
      calls.cloud++
      return []
    },
    byok: async () => [],
    usage: async () => {
      throw new Error("unused")
    },
  })

const plugins = Layer.mock(PluginV2.Service)({
  add: () => Effect.void,
  remove: () => Effect.void,
  wait: () => Effect.void,
})

const configuredLayer = (input: {
  calls: { direct: number; cloud: number }
  direct?: DirectInput
  accountID?: string
  config?: CatalogInput
  failure?: () => "global" | "china" | "kilo" | undefined
  transport?: ProviderUsage.TransportInterface
}) =>
  Layer.fresh(ProviderUsage.layer).pipe(
    Layer.provide(catalog(input.config)),
    Layer.provide(connections(input.direct, input.accountID, input.failure)),
    Layer.provide(input.transport ? Layer.succeed(ProviderUsage.Transport, input.transport) : transport(input.calls)),
    Layer.provide(plugins),
  )

const layer = (
  calls: { direct: number; cloud: number },
  direct: DirectInput = "sk-cp-direct",
  accountID?: string,
  config?: CatalogInput,
  failure?: () => "global" | "china" | "kilo" | undefined,
) => configuredLayer({ calls, direct, accountID, config, failure })

const it = testEffect(Layer.empty)

const service = Effect.fn("ProviderUsageTest.service")(function* (service: ProviderUsage.Interface) {
  const first = yield* service.get()
  const cached = yield* service.get()
  const refreshed = yield* service.refresh()
  return { first, cached, refreshed }
})

describe("ProviderUsage location service", () => {
  it.live("caches one location and forces every source on refresh", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const scope = yield* Scope.make()
      const usage = Context.get(yield* Layer.buildWithScope(layer(calls), scope), ProviderUsage.Service)

      const result = yield* service(usage)

      expect(result.first.items).toHaveLength(1)
      expect(result.cached).toEqual(result.first)
      expect(result.refreshed.items).toHaveLength(1)
      expect(calls).toEqual({ direct: 2, cloud: 2 })
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.live("isolates state between location-layer instances", () =>
    Effect.gen(function* () {
      const firstCalls = { direct: 0, cloud: 0 }
      const secondCalls = { direct: 0, cloud: 0 }
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const first = Context.get(yield* Layer.buildWithScope(layer(firstCalls), firstScope), ProviderUsage.Service)
      const second = Context.get(yield* Layer.buildWithScope(layer(secondCalls), secondScope), ProviderUsage.Service)

      expect((yield* first.get()).items[0]?.windows[0]?.remaining).toBe(80)
      expect((yield* second.get()).items[0]?.windows[0]?.remaining).toBe(80)
      expect(firstCalls.direct).toBe(1)
      expect(secondCalls.direct).toBe(1)
    }),
  )

  it.live("suppresses personal Cloud calls for organization OAuth", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(layer(calls, "sk-cp-direct", "org"), scope),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(1)
      expect(calls).toEqual({ direct: 1, cloud: 0 })
    }),
  )

  it.live("uses every canonical config-defined coding-plan key location", () =>
    Effect.gen(function* () {
      for (const config of [
        { apiKey: "sk-cp-body" },
        { setting: "sk-cp-setting" },
        { header: "sk-cp-header", headerName: "X-API-Key" },
      ]) {
        const calls = { direct: 0, cloud: 0 }
        const scope = yield* Scope.make()
        const usage = Context.get(
          yield* Layer.buildWithScope(layer(calls, undefined, "org", config), scope),
          ProviderUsage.Service,
        )
        expect((yield* usage.get()).items[0]?.providerID).toBe("minimax-coding-plan")
        expect(calls.direct).toBe(1)
      }
    }),
  )

  it.live("suppresses personal Cloud calls for configured organization routing", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(layer(calls, "sk-cp-direct", undefined, { organization: "org" }), scope),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(1)
      expect(calls).toEqual({ direct: 1, cloud: 0 })
    }),
  )

  it.live("ignores empty configured organization routing", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(layer(calls, "sk-cp-direct", undefined, { organization: "   " }), scope),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(1)
      expect(calls).toEqual({ direct: 1, cloud: 1 })
    }),
  )

  it.live("replaces cached direct usage when the credential changes", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      let key = "sk-cp-first"
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          layer(calls, () => key, "org"),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items[0]?.windows[0]?.remaining).toBe(80)
      key = "sk-cp-second"
      expect((yield* usage.get()).items[0]?.windows[0]?.remaining).toBe(80)
      expect(calls.direct).toBe(2)
    }),
  )

  it.live("coalesces a forced refresh with an in-flight read", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const started = yield* Deferred.make<void>()
      let release!: (value: Response) => void
      const response = new Promise<Response>((resolve) => (release = resolve))
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            direct: "sk-cp-direct",
            accountID: "org",
            transport: {
              fetch: (() => {
                calls.direct++
                Effect.runSync(Deferred.succeed(started, undefined))
                return response
              }) as unknown as typeof fetch,
              plans: async () => [],
              byok: async () => [],
              usage: async () => {
                throw new Error("unused")
              },
            },
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      const first = yield* usage.get().pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* usage.refresh().pipe(Effect.forkChild)
      yield* Effect.yieldNow
      release(native(80))

      expect((yield* Fiber.join(first)).items).toHaveLength(1)
      expect((yield* Fiber.join(second)).items).toHaveLength(1)
      expect(calls.direct).toBe(1)
    }),
  )

  it.live("serves stale data after a failed refresh and recovers on retry", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const responses = [native(80), new Response("private upstream error", { status: 503 }), native(70)]
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            direct: "sk-cp-direct",
            accountID: "org",
            transport: {
              fetch: mock(() => {
                calls.direct++
                return Promise.resolve(responses.shift()!)
              }) as unknown as typeof fetch,
              plans: async () => [],
              byok: async () => [],
              usage: async () => {
                throw new Error("unused")
              },
            },
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      const ready = yield* usage.get()
      const stale = yield* usage.refresh()
      const recovered = yield* usage.refresh()

      expect(ready.items[0]).toMatchObject({ fetchState: "ready", windows: [{ remaining: 80 }] })
      expect(stale.items[0]).toMatchObject({ fetchState: "stale", windows: [{ remaining: 80 }] })
      expect(recovered.items[0]).toMatchObject({ fetchState: "ready", windows: [{ remaining: 70 }] })
      expect(JSON.stringify(stale)).not.toContain("private upstream error")
    }),
  )

  it.live("expires the success cache and retries failures on the shorter error TTL", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const responses = [native(80), new Response("upstream failure", { status: 503 }), native(70)]
      const base = Date.parse("2026-08-12T00:00:00.000Z")
      setSystemTime(new Date(base))
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            direct: "sk-cp-direct",
            accountID: "org",
            transport: {
              fetch: mock(() => {
                calls.direct++
                return Promise.resolve(responses.shift()!)
              }) as unknown as typeof fetch,
              plans: async () => [],
              byok: async () => [],
              usage: async () => {
                throw new Error("unused")
              },
            },
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items[0]).toMatchObject({ fetchState: "ready", windows: [{ remaining: 80 }] })
      expect((yield* usage.get()).items[0]).toMatchObject({ fetchState: "ready" })
      expect(calls.direct).toBe(1)

      // Success TTL (60s) elapsed: the next get refetches and degrades to stale on failure.
      setSystemTime(new Date(base + 61_000))
      expect((yield* usage.get()).items[0]).toMatchObject({ fetchState: "stale", windows: [{ remaining: 80 }] })
      expect((yield* usage.get()).items[0]).toMatchObject({ fetchState: "stale" })
      expect(calls.direct).toBe(2)

      // Error TTL (10s) elapsed: the failure is retried and recovers.
      setSystemTime(new Date(base + 72_000))
      expect((yield* usage.get()).items[0]).toMatchObject({ fetchState: "ready", windows: [{ remaining: 70 }] })
      expect(calls.direct).toBe(3)
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.ensuring(Effect.sync(() => setSystemTime()))),
  )

  it.live("prunes authoritative removal but preserves a transient credential failure", () =>
    Effect.gen(function* () {
      const removedCalls = { direct: 0, cloud: 0 }
      let removedKey: string | undefined = "sk-cp-present"
      const removedScope = yield* Scope.make()
      const removed = Context.get(
        yield* Layer.buildWithScope(
          layer(removedCalls, () => removedKey, "org"),
          removedScope,
        ),
        ProviderUsage.Service,
      )
      expect((yield* removed.get()).items).toHaveLength(1)
      removedKey = undefined
      expect((yield* removed.get()).items).toEqual([])

      const failedCalls = { direct: 0, cloud: 0 }
      let failure: "global" | undefined
      const failedScope = yield* Scope.make()
      const failed = Context.get(
        yield* Layer.buildWithScope(
          layer(failedCalls, "sk-cp-present", "org", undefined, () => failure),
          failedScope,
        ),
        ProviderUsage.Service,
      )
      expect((yield* failed.get()).items).toHaveLength(1)
      failure = "global"
      expect((yield* failed.get()).items[0]).toMatchObject({ fetchState: "stale" })
      expect(failedCalls.direct).toBe(1)
    }),
  )

  it.live("preserves only the failed direct provider while pruning a removed sibling", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      let chinaKey: string | undefined = "sk-cp-china"
      let failure: "global" | undefined
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            accountID: "org",
            config: { china: true, apiKey: "sk-cp-fallback" },
            direct: (id) => (id === chinaIntegration ? chinaKey : "sk-cp-global"),
            failure: () => failure,
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(2)
      failure = "global"
      chinaKey = undefined
      const result = yield* usage.get()

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ providerID: "minimax-coding-plan", fetchState: "stale" })
      expect(calls.direct).toBe(2)
    }),
  )

  it.live("keeps same-key providers independent when one credential fails", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      let failure: "global" | undefined
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            accountID: "org",
            config: { china: true },
            direct: "sk-cp-shared",
            failure: () => failure,
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(2)
      failure = "global"
      const result = yield* usage.get()

      expect(result.items).toHaveLength(2)
      expect(result.items.find((item) => item.id === "minimax-direct-global")).toMatchObject({ fetchState: "stale" })
      expect(result.items.find((item) => item.id === "minimax-direct-china")).toMatchObject({ fetchState: "ready" })
      // The surviving sibling serves from cache; the failed one is not refetched.
      expect(calls.direct).toBe(2)
    }),
  )

  it.live("refreshes a rotated credential while preserving the failed sibling's cached usage", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      let failure: "global" | undefined
      let key = "sk-cp-shared"
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            accountID: "org",
            config: { china: true },
            direct: () => key,
            failure: () => failure,
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(2)
      failure = "global"
      key = "sk-cp-rotated"
      const result = yield* usage.get()

      expect(result.items).toHaveLength(2)
      expect(result.items.find((item) => item.id === "minimax-direct-global")).toMatchObject({ fetchState: "stale" })
      expect(result.items.find((item) => item.id === "minimax-direct-china")).toMatchObject({ fetchState: "ready" })
      expect(calls.direct).toBe(3)
    }),
  )

  it.live("omits a failed provider with no cached usage", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            accountID: "org",
            config: { china: true },
            direct: "sk-cp-shared",
            failure: () => "global" as const,
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      const result = yield* usage.get()

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ id: "minimax-direct-china", fetchState: "ready" })
      expect(calls.direct).toBe(1)
    }),
  )

  it.live("preserves managed usage across metadata and credential failures while direct usage refreshes", () =>
    Effect.gen(function* () {
      const calls = { direct: 0, cloud: 0 }
      let byokFailure = false
      let usageFailure = false
      let credentialFailure: "kilo" | undefined
      let organization: string | undefined
      const scope = yield* Scope.make()
      const usage = Context.get(
        yield* Layer.buildWithScope(
          configuredLayer({
            calls,
            direct: "sk-cp-direct",
            config: { organization: () => organization },
            failure: () => credentialFailure,
            transport: {
              fetch: mock(() => {
                calls.direct++
                return Promise.resolve(native(80))
              }) as unknown as typeof fetch,
              plans: async () => {
                calls.cloud++
                return [subscription]
              },
              byok: async () => {
                if (byokFailure) throw new Error("private metadata failure")
                return [byok]
              },
              usage: async () => {
                if (usageFailure) throw new Error("private usage failure")
                return {
                  schemaVersion: 1,
                  fetchedAt: "2026-08-09T12:00:00.000Z",
                  subscription: {
                    id: subscription.id,
                    planName: subscription.planName,
                    providerId: subscription.providerId,
                    providerName: subscription.providerName,
                    windows: [
                      {
                        id: "monthly",
                        remainingPercent: 75,
                        resetsAt: "2026-09-01T00:00:00.000Z",
                        period: { unit: "month", value: 1 },
                      },
                    ],
                  },
                }
              },
            },
          }),
          scope,
        ),
        ProviderUsage.Service,
      )

      expect((yield* usage.get()).items).toHaveLength(2)
      byokFailure = true
      const partial = yield* usage.refresh()
      // Discovery failure retains the last good Cloud state, so usage still refreshes.
      expect(partial.items.find((item) => item.sourceKind === "kilo_managed")).toMatchObject({ fetchState: "ready" })
      expect(partial.items.find((item) => item.sourceKind === "direct")).toMatchObject({ fetchState: "ready" })
      expect(JSON.stringify(partial)).not.toContain("private metadata failure")

      usageFailure = true
      const degraded = yield* usage.refresh()
      expect(degraded.items.find((item) => item.sourceKind === "kilo_managed")).toMatchObject({ fetchState: "stale" })
      expect(JSON.stringify(degraded)).not.toContain("private usage failure")

      byokFailure = false
      usageFailure = false
      credentialFailure = "kilo"
      const credential = yield* usage.get()
      expect(credential.items.find((item) => item.sourceKind === "kilo_managed")).toMatchObject({
        fetchState: "stale",
      })
      expect(credential.items.find((item) => item.sourceKind === "direct")).toBeDefined()

      organization = "org"
      const organizationResult = yield* usage.get()
      expect(organizationResult.items.find((item) => item.sourceKind === "kilo_managed")).toBeUndefined()
      expect(organizationResult.items.find((item) => item.sourceKind === "direct")).toBeDefined()
    }),
  )
})
