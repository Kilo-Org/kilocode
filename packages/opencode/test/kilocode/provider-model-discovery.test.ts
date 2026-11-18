import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { afterAll, expect } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))

const hits: { path: string; auth: string | null; team: string | null }[] = []
const server = Bun.serve({
  port: 0,
  idleTimeout: 0, // the stalled endpoint below must only be cut off by the client
  fetch(req) {
    const url = new URL(req.url)
    hits.push({ path: url.pathname, auth: req.headers.get("authorization"), team: req.headers.get("x-team") })
    if (url.pathname.startsWith("/broken/")) return new Response("unavailable", { status: 503 })
    // Sends 200 headers and part of the body, then never finishes it.
    if (url.pathname.startsWith("/stall/"))
      return new Response(new ReadableStream({ start: (ctl) => ctl.enqueue(new TextEncoder().encode('{"data":[')) }), {
        headers: { "content-type": "application/json" },
      })
    return Response.json({ object: "list", data: [{ id: "org/alpha", object: "model" }, { id: "beta" }] })
  },
})
afterAll(() => server.stop(true))

const base = (name: string) => `http://127.0.0.1:${server.port}/${name}/v1`
const calls = (name: string) => hits.filter((hit) => hit.path === `/${name}/v1/models`)

function apply(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    if (value !== undefined) process.env[key] = value
  }
}

// KILO_CONFIG_CONTENT is a trusted source, like the user's global config.
const env = <A, E, R>(values: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      apply(values)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => apply(previous)),
  )

const gateway = (provider: Record<string, unknown>) => JSON.stringify({ provider: { gw: provider } })

const list = Effect.gen(function* () {
  const provider = yield* Provider.Service
  return (yield* provider.list())[ProviderV2.ID.make("gw")]
})

it.instance(
  "adds models served by an opted-in endpoint and lets configured models win",
  () =>
    env(
      {
        KILO_CONFIG_CONTENT: gateway({
          name: "Gateway",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: base("one"), apiKey: "secret", headers: { "X-Team": "core" }, discoverModels: true },
          models: { beta: { name: "Beta pinned", limit: { context: 1000, output: 100 } } },
        }),
      },
      Effect.gen(function* () {
        const item = yield* list
        expect(Object.keys(item?.models ?? {}).sort()).toEqual(["beta", "org/alpha"])
        expect(item?.models["beta"]?.name).toBe("Beta pinned")
        expect(item?.models["beta"]?.limit.context).toBe(1000)
        expect(item?.models["org/alpha"]?.api.id).toBe("org/alpha")
        expect(item?.models["org/alpha"]?.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(calls("one")).toEqual([{ path: "/one/v1/models", auth: "Bearer secret", team: "core" }])
      }),
    ),
  { config: {} },
)

it.instance(
  "authenticates discovery with the provider env var",
  () =>
    env(
      {
        KILO_CONFIG_CONTENT: gateway({
          env: ["GW_DISCOVERY_KEY"],
          options: { baseURL: base("two"), discoverModels: true },
        }),
        GW_DISCOVERY_KEY: "from-env",
      },
      Effect.gen(function* () {
        const item = yield* list
        expect(Object.keys(item?.models ?? {}).sort()).toEqual(["beta", "org/alpha"])
        expect(calls("two").map((hit) => hit.auth)).toEqual(["Bearer from-env"])
      }),
    ),
  { config: {} },
)

it.instance(
  "authenticates discovery with a stored API key",
  () =>
    env(
      {
        KILO_CONFIG_CONTENT: gateway({ options: { baseURL: base("three"), discoverModels: true } }),
        KILO_AUTH_CONTENT: JSON.stringify({ gw: { type: "api", key: "stored" } }),
      },
      Effect.gen(function* () {
        const item = yield* list
        expect(item?.models["org/alpha"]).toBeDefined()
        expect(calls("three").map((hit) => hit.auth)).toEqual(["Bearer stored"])
      }),
    ),
  { config: {} },
)

it.instance(
  "does not call /models without the opt-in",
  () =>
    env(
      { KILO_CONFIG_CONTENT: gateway({ options: { baseURL: base("four"), apiKey: "secret" } }) },
      Effect.gen(function* () {
        expect(yield* list).toBeUndefined()
        expect(calls("four")).toHaveLength(0)
      }),
    ),
  { config: {} },
)

it.instance(
  "keeps configured models when the endpoint fails",
  () =>
    env(
      {
        KILO_CONFIG_CONTENT: gateway({
          options: { baseURL: base("broken"), apiKey: "secret", discoverModels: true },
          models: { beta: {} },
        }),
      },
      Effect.gen(function* () {
        const item = yield* list
        expect(Object.keys(item?.models ?? {})).toEqual(["beta"])
        expect(calls("broken")).toHaveLength(1)
      }),
    ),
  { config: {} },
)

it.instance(
  "gives up on an endpoint whose body never finishes",
  () =>
    env(
      {
        KILO_CONFIG_CONTENT: gateway({
          options: { baseURL: base("stall"), apiKey: "secret", discoverModels: true },
          models: { beta: {} },
        }),
      },
      Effect.gen(function* () {
        const start = Date.now()
        const item = yield* list
        expect(Object.keys(item?.models ?? {})).toEqual(["beta"])
        expect(calls("stall")).toHaveLength(1)
        expect(Date.now() - start).toBeLessThan(20_000)
      }),
    ),
  { config: {} },
  30_000,
)

it.instance(
  "ignores the opt-in from project config",
  () =>
    env(
      { KILO_CONFIG_CONTENT: undefined },
      Effect.gen(function* () {
        expect(yield* list).toBeUndefined()
        expect(calls("six")).toHaveLength(0)
      }),
    ),
  {
    config: {
      provider: { gw: { options: { baseURL: base("six"), apiKey: "secret", discoverModels: true } } },
    },
  },
)

// KILO_CONFIG_CONTENT merges after project config, so it must not revive a target the project chose.
it.instance(
  "keeps discovery off for a provider that project config retargets",
  () =>
    env(
      { KILO_CONFIG_CONTENT: gateway({ options: { apiKey: "secret", discoverModels: true }, models: { beta: {} } }) },
      Effect.gen(function* () {
        const item = yield* list
        expect(Object.keys(item?.models ?? {})).toEqual(["beta"])
        expect(item?.options.discoverModels).toBe(false)
        expect(calls("seven")).toHaveLength(0)
      }),
    ),
  { config: { provider: { gw: { options: { baseURL: base("seven") } } } } },
)

it.instance(
  "keeps discovery on when project config only renames the provider",
  () =>
    env(
      { KILO_CONFIG_CONTENT: gateway({ options: { baseURL: base("eight"), apiKey: "secret", discoverModels: true } }) },
      Effect.gen(function* () {
        const item = yield* list
        expect(item?.name).toBe("Renamed")
        expect(calls("eight")).toHaveLength(1)
      }),
    ),
  { config: { provider: { gw: { name: "Renamed" } } } },
)
