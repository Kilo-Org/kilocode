import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"
import { App } from "@opencode/core/app"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloApp } from "../src/app"
import { KiloHost } from "../src/host"

// The general user agent under the Kilo host: `kilo/<channel>/<version>/<client>`, where upstream sends
// `opencode/<channel>/<version>/<client>`. The Kilo Gateway and the Codex sign-in have their own user agents,
// covered by gateway-usage.test.ts and openai.test.ts.
const repo = path.resolve(import.meta.dir, "../../..")
const kilo = `kilo/${OPENCODE_CHANNEL}/${OPENCODE_VERSION}/${KiloApp.name}`

test("the Kilo app identity leads the user agent with the Kilo product", () => {
  expect(KiloApp.product.id).toBe("kilo")
  expect(App.useragent(App.make(KiloApp))).toBe(kilo)
  expect(App.useragent(App.make({ ...KiloApp, product: undefined }))).toBe(`opencode${kilo.slice("kilo".length)}`)
})

test.each([
  [{}, "kilo2"],
  [{ KILO_CLIENT: "vscode" }, "vscode"],
  [{ OPENCODE_CLIENT: "desktop" }, "desktop"],
  [{ KILO_CLIENT: "jetbrains", OPENCODE_CLIENT: "desktop" }, "jetbrains"],
])("the client name of %o is the last segment of the Kilo user agent", async (client, name) => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/user-agent.ts")], {
    cwd: repo,
    env: {
      // An outer Kilo or OpenCode process may export its own client name; only the scenario sets one here.
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KILO|OPENCODE)_CLIENT$/.test(key))),
      BUN_OPTIONS: "",
      ...client,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(stdout.trim()).toBe(`kilo/${OPENCODE_CHANNEL}/${OPENCODE_VERSION}/${name}`)
})

// Only the HTTP peers are stand-ins: a model catalog mirror and an OpenAI-compatible provider on one loopback
// server. The server graph, the catalog fetch and the model request are real.
test.each([
  ["the Kilo host", KiloHost.overrides, kilo],
  ["no host", [], App.useragent(App.make())],
] as const)(
  "with %s, the catalog fetch and a model request send the general user agent",
  async (_, overrides, expected) => {
    using backend = peer()
    await boot(backend.url, overrides, async (client, directory) => {
      const session = await client.session.create({
        location: { directory },
        model: { providerID: "fixture", id: "echo" },
      })
      await client.session.prompt({ sessionID: session.id, text: "Say hello." })
      await client.session.wait({ sessionID: session.id })
      const messages = await client.session.context({ sessionID: session.id })
      expect(messages.find((message) => message.type === "assistant")?.content).toContainEqual({
        type: "text",
        text: "hello from the fixture",
      })
    })
    const catalog = backend.requests.filter((request) => request.kind === "catalog")
    const model = backend.requests.filter((request) => request.kind === "model")
    expect(catalog.length).toBeGreaterThan(0)
    expect(model.length).toBeGreaterThan(0)
    expect([...new Set(backend.requests.map((request) => request.userAgent))]).toEqual([expected])
    // The client name also travels in its own header, which the product does not change.
    expect([...new Set(model.map((request) => request.client))]).toEqual([expected.split("/").at(-1) ?? null])
  },
  30_000,
)

function peer() {
  const requests: { kind: "catalog" | "model"; userAgent: string | null; client: string | null }[] = []
  const chunk = (input: object) => `data: ${JSON.stringify({ id: "chatcmpl-fixture", model: "echo", ...input })}\n\n`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const entry = { userAgent: request.headers.get("user-agent"), client: request.headers.get("x-opencode-client") }
      if (url.pathname.endsWith("/api.json")) {
        requests.push({ kind: "catalog", ...entry })
        // An empty catalog: the provider under test comes from config.
        return Response.json({})
      }
      if (url.pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      requests.push({ kind: "model", ...entry })
      return new Response(
        chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "hello from the fixture" } }] }) +
          chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
          chunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return {
    requests,
    url: server.url.origin,
    [Symbol.dispose]: () => void server.stop(true),
  }
}

async function boot(
  url: string,
  overrides: typeof KiloHost.overrides,
  body: (client: ReturnType<typeof OpenCode.make>, directory: string) => Promise<void>,
) {
  using gateway = fixture()
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-user-agent-"))
  const directory = path.join(root, "repo")
  await Bun.write(path.join(directory, ".keep"), "")
  const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
  process.env.KILO_API_URL = gateway.url
  delete process.env.KILO_API_KEY
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { url, fetch: true },
                fs: { filewatcher: false },
                config: {
                  directory: path.join(root, "global"),
                  project: false,
                  content: JSON.stringify({
                    model: "fixture/echo",
                    provider: {
                      fixture: {
                        npm: "@ai-sdk/openai-compatible",
                        options: { baseURL: `${url}/v1`, apiKey: "fixture-key" },
                        models: { echo: { name: "Echo" } },
                      },
                    },
                  }),
                },
              },
              () => [],
              overrides,
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
          yield* Effect.promise(() => body(client, directory))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    await rm(root, { recursive: true, force: true })
  }
}
