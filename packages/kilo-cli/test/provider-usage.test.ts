import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// `/usage` data end to end: the `kilocode.provider-usage` RPC of packages/kilo-plugin, registered by the host, called
// through the generated client. It reads the Kilo coding plans through the `kilocode.gateway` RPC from a local
// stand-in for the Kilo API.
const boot =
  (
    env: Record<string, string>,
    body: (input: { usage: ReturnType<typeof rpc>; backend: ReturnType<typeof fixture> }) => Promise<void>,
  ) =>
  async () => {
    using backend = fixture()
    backend.state.byok = {
      result: {
        data: {
          json: [
            { id: "byok-1", provider_id: "anthropic", management_source: "coding_plan", is_enabled: true },
            { id: "byok-2", provider_id: "openai", management_source: "user", is_enabled: false },
          ],
        },
      },
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-provider-usage-"))
    const variables = { ...signedOut, KILO_API_URL: backend.url, ...env }
    const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
    apply(variables)
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: false },
                  config: { directory, project: false },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            yield* Effect.promise(() => body({ usage: rpc(client, directory), backend }))
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      apply(previous)
      await rm(directory, { recursive: true, force: true })
    }
  }

const signedOut = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_ORG_ID: undefined,
  KILO_AI_GATEWAY_URL: undefined,
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

function rpc(client: ReturnType<typeof OpenCode.make>, directory: string) {
  const usage = client.rpc(ProviderUsage.Definition)
  const options = { location: { directory } }
  return { get: () => usage.get({}, options), refresh: () => usage.refresh({}, options) }
}

test(
  "a signed-in personal account reads its coding plan quota through the generated client",
  boot({ KILO_API_KEY: "fixture-token" }, async ({ usage, backend }) => {
    const result = await usage.get()
    expect(result.items).toEqual([
      {
        id: "kilo-managed:sub-1",
        providerID: "anthropic",
        sourceKind: "kilo_managed",
        providerLabel: "Anthropic",
        planLabel: "Kilo Coding Plan Pro",
        sourceLabel: "via Kilo",
        fetchState: "ready",
        planState: "active",
        routingState: "active",
        fetchedAt: "2026-10-14T12:00:00Z",
        managementUrl: `${backend.url}/subscriptions/coding-plans/sub-1`,
        windows: [
          {
            id: "sub-1:five_hour",
            resource: "subscription",
            unit: "percent",
            orientation: "remaining_percent",
            used: 25,
            remaining: 75,
            limit: 100,
            period: { unit: "hour", value: 5 },
            durationMs: 18_000_000,
            resetAt: "2026-10-14T17:00:00Z",
            state: "active",
          },
        ],
      },
    ])
    expect(backend.requests.filter((request) => request.path === "/api/trpc/codingPlans.getUsage")).toHaveLength(1)

    // A plan whose usage request fails stays visible as unavailable.
    backend.state.codingPlanUsageStatus = 500
    expect((await usage.refresh()).items).toMatchObject([
      { id: "kilo-managed:sub-1", fetchState: "unavailable", error: { message: "Usage unavailable." } },
    ])
  }),
  30_000,
)

test(
  "a team account has no coding plans",
  boot({ KILO_API_KEY: "fixture-token", KILO_ORG_ID: "selected" }, async ({ usage, backend }) => {
    expect((await usage.get()).items).toEqual([])
    expect(backend.requests.some((request) => request.path.startsWith("/api/trpc/codingPlans"))).toBe(false)
  }),
  30_000,
)

test(
  "a signed-out client gets an empty answer",
  boot({}, async ({ usage }) => {
    expect((await usage.get()).items).toEqual([])
  }),
  30_000,
)
