import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

type CatalogModel = { id: string; providerID: string; cost: { input: number }[] }

const free = (model: CatalogModel) => !model.cost.some((cost) => cost.input > 0)
const ids = (models: CatalogModel[], providerID: string, filter: (model: CatalogModel) => boolean = () => true) =>
  models
    .filter((model) => model.providerID === providerID && filter(model))
    .map((model) => model.id)
    .sort()

// The catalog of the server the host starts, with the bundled models.dev snapshot and a local Gateway stand-in.
test.each([
  { name: "signed out of Kilo", env: {}, kilo: ["kilo-auto/free", "kilo-auto/small"] },
  {
    name: "a personal Kilo account",
    env: { KILO_API_KEY: "fixture-token" },
    kilo: ["kilo-auto/free", "kilo-auto/frontier", "kilo-auto/small"],
  },
  {
    name: "a Kilo organization",
    env: { KILO_API_KEY: "fixture-token", KILO_ORG_ID: "selected" },
    kilo: ["anthropic/claude-sonnet-4.6", "kilo-auto/small"],
  },
])(
  "$name without an OpenCode credential lists no OpenCode model and keeps the Kilo models",
  async (input) => {
    const { models } = await catalog({ env: input.env })
    expect(ids(models, "kilo")).toEqual([...input.kilo])
    expect(ids(models, "opencode")).toEqual([])
    expect(ids(models, "opencode-go")).toEqual([])
  },
  30_000,
)

test("an explicit OpenCode key keeps the paid OpenCode models and removes the free tier", async () => {
  const { models } = await catalog({
    config: { providers: { opencode: { settings: { apiKey: "test-opencode-key" } } } },
  })
  expect(ids(models, "opencode").length).toBeGreaterThan(0)
  expect(ids(models, "opencode", free)).toEqual([])
  expect(ids(models, "kilo", free)).toEqual(["kilo-auto/free", "kilo-auto/small"])
}, 30_000)

// Earlier testing found that a cold or failed Kilo catalog made the TUI fall back to an OpenCode free model.
test("a failed Kilo catalog does not fall back to an OpenCode free model", async () => {
  const result = await catalog({ modelsStatus: 503 })
  // Other providers depend on the machine (for example AWS credentials enable Amazon Bedrock).
  expect(ids(result.models, "kilo")).toEqual([])
  expect(ids(result.models, "opencode")).toEqual([])
  expect(result.fallback?.providerID).not.toBe("opencode")
}, 30_000)

async function catalog(input: { env?: Record<string, string | undefined>; config?: unknown; modelsStatus?: number }) {
  using backend = fixture()
  if (input.modelsStatus) backend.state.modelsStatus = input.modelsStatus
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-opencode-free-"))
  const saved = Object.fromEntries(
    ["KILO_API_URL", "KILO_API_KEY", "KILO_ORG_ID", "OPENCODE_API_KEY"].map((key) => [key, process.env[key]]),
  )
  for (const key of Object.keys(saved)) delete process.env[key]
  Object.assign(process.env, { KILO_API_URL: backend.url, ...input.env })
  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: {
                  directory,
                  project: false,
                  ...(input.config ? { content: JSON.stringify(input.config) } : {}),
                },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const get = (route: string) =>
            Effect.promise(async () => {
              const url = new URL(route, "http://kilo.local")
              url.searchParams.set("location[directory]", directory)
              const response = await handler(
                new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
              )
              return (await response.json()).data
            })
          // The model routes wait for plugin activation; the Gateway catalog request finishes later.
          yield* eventually(get("/api/model") as Effect.Effect<CatalogModel[]>, (list) =>
            input.modelsStatus
              ? backend.requests.some((request) => request.path.endsWith("/models"))
              : list.some((model) => model.providerID === "kilo"),
          )
          return {
            models: (yield* get("/api/model")) as CatalogModel[],
            fallback: (yield* get("/api/model/default")) as CatalogModel | undefined,
          }
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function eventually<A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, remaining = 200): Effect.Effect<A> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value) || remaining === 0) return value
    yield* Effect.sleep("25 millis")
    return yield* eventually(effect, predicate, remaining - 1)
  })
}
