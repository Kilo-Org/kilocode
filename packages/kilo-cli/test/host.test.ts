import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Permission } from "@opencode/core/permission"
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

// The real plugin order of the server the host starts: the Kilo agents before the config plugins, the agent ceiling
// in the post phase after all internal post plugins (config agents, browser). A global allow-all must not open Ask or
// Plan, and Plan keeps its per-agent opt-in.
test("the server runs the Kilo agent ceiling after the config plugins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-host-"))
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
                config: {
                  directory,
                  project: false,
                  content: JSON.stringify({
                    permissions: [{ action: "*", resource: "*", effect: "allow" }],
                    agents: {
                      plan: { permissions: [{ action: "shell", resource: "cargo search *", effect: "allow" }] },
                    },
                  }),
                },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const agents = Effect.promise(async () => {
            const url = new URL("/api/agent", "http://kilo.local")
            url.searchParams.set("location[directory]", directory)
            const response = await handler(
              new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
            )
            return (await response.json()).data as {
              id: string
              mode: string
              hidden: boolean
              permissions: Permission.Rule[]
            }[]
          })
          // The ceiling removes the config probe agent last, so its absence means the generation is complete.
          const list = yield* eventually(
            agents,
            (data) =>
              data.some((agent) => agent.id === "ask") && !data.some((agent) => agent.id === "kilo-config-permissions"),
          )
          const effect = (id: string, action: string, resource: string) =>
            Permission.evaluate(action, resource, list.find((agent) => agent.id === id)?.permissions ?? []).effect

          expect(list.filter((agent) => agent.mode !== "subagent" && !agent.hidden).map((agent) => agent.id)).toEqual([
            "code",
            "ask",
            "debug",
            "orchestrator",
            "plan",
          ])
          expect(effect("code", "edit", "src/index.ts")).toBe("allow")
          for (const id of ["ask", "plan"]) {
            expect(effect(id, "edit", "src/index.ts")).toBe("deny")
            expect(effect(id, "shell", "rm -rf src")).toBe("deny")
          }
          expect(effect("plan", "shell", "cargo search serde")).toBe("allow")
          expect(effect("orchestrator", "shell", "ls")).toBe("deny")
          expect(list.map((agent) => agent.id)).not.toContain("kilo-config-permissions")
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
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
