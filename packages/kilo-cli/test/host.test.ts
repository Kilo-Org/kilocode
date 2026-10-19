import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The server the host starts: the upstream routes with the host overrides, as `serve` builds them. The Gateway
// reads its catalog from a local stand-in for the Kilo API.
test("the server gets the Kilo plugins through SdkPlugins and serves the Kilo Gateway provider", async () => {
  using backend = fixture()
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-host-"))
  process.env.KILO_API_URL = backend.url
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
          const get = (route: string) =>
            Effect.promise(async () => {
              const url = new URL(route, "http://kilo.local")
              url.searchParams.set("location[directory]", directory)
              const response = await handler(
                new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
              )
              return { status: response.status, body: await response.json() }
            })

          const plugins = yield* eventually(get("/api/plugin"), (result) =>
            JSON.stringify(result.body).includes("kilocode.gateway"),
          )
          expect(plugins.body.data).toContainEqual(
            expect.objectContaining({ id: "kilocode.gateway", source: { type: "sdk" }, state: { status: "active" } }),
          )

          const provider = yield* eventually(
            get("/api/provider/kilo"),
            (result) => result.body.data?.settings?.baseURL === `${backend.url}/api/gateway/v1`,
          )
          expect(provider.status).toBe(200)
          expect(provider.body.data.headers).toMatchObject({
            "HTTP-Referer": "https://kilocode.ai",
            "X-Title": "Kilo Code",
          })
          expect(backend.requests.some((request) => request.path.includes("models"))).toBe(true)
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    delete process.env.KILO_API_URL
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

function eventually<A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, remaining = 200): Effect.Effect<A> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value) || remaining === 0) return value
    yield* Effect.sleep("25 millis")
    return yield* eventually(effect, predicate, remaining - 1)
  })
}
