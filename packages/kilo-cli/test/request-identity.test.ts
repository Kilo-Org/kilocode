import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"
import { App } from "@opencode/core/app"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloApp } from "../src/app"
import { KiloHost } from "../src/host"

// The identity headers that leave the process on a model request, per provider, with and without the Kilo host.
// Only the HTTP peer is a stand-in: one loopback server takes the place of every provider and of the Kilo API. The
// server graph, the plugins, the hook pipeline and the provider protocols are real.
const repo = path.resolve(import.meta.dir, "../../..")
const upstream = App.useragent(App.make({ ...KiloApp, product: undefined }))
const clientAgent = `kilo/${OPENCODE_CHANNEL}/${OPENCODE_VERSION}/${KiloApp.name}`
const productAgent = `Kilo-Code/${OPENCODE_VERSION}`
const kiloReferer = { referer: "https://kilocode.ai", title: "Kilo Code" }
const none = { referer: null, title: null }
const gatewayModel = "kilo-auto/frontier"

const hosted = {
  // The client user agent, and no referer.
  anthropic: { userAgent: clientAgent, ...none },
  opencode: { userAgent: clientAgent, ...none },
  // The product user agent with the Kilo referer and title, also where the catalog or config names another one.
  byok: { userAgent: productAgent, ...kiloReferer },
  openrouter: { userAgent: productAgent, ...kiloReferer },
  azure: { userAgent: productAgent, ...kiloReferer },
  configured: { userAgent: productAgent, ...kiloReferer },
  // Left as the server and the provider's own plugin build them.
  openai: { userAgent: upstream, ...none },
  "github-copilot": { userAgent: upstream, ...none },
  // The Gateway plugin's own identity.
  kilo: { userAgent: `Kilo-Code/v2/${OPENCODE_VERSION}`, ...kiloReferer },
}

const unhostedAgent = App.useragent(App.make())
const unhosted = {
  anthropic: { userAgent: unhostedAgent, ...none },
  opencode: { userAgent: unhostedAgent, ...none },
  byok: { userAgent: unhostedAgent, ...none },
  openrouter: { userAgent: unhostedAgent, referer: "https://opencode.ai/", title: "opencode" },
  azure: { userAgent: unhostedAgent, ...none },
  configured: { userAgent: unhostedAgent, referer: "https://configured.example", title: "Configured" },
  openai: { userAgent: unhostedAgent, ...none },
  "github-copilot": { userAgent: unhostedAgent, ...none },
}

test("with the Kilo host, each provider gets its identity and the Gateway, OpenAI and Copilot keep theirs", async () => {
  using backend = peer()
  await boot(backend.url, KiloHost.overrides, async (client, directory) => {
    // A real client waits for the Gateway catalog the same way before it prompts a Kilo model.
    const models = await client.rpc(KiloGatewayRpc.Definition).models({}, { location: { directory } })
    expect(models.map((model) => model.id)).toContain(gatewayModel)
    for (const id of Object.keys(hosted))
      await prompt(client, directory, { providerID: id, id: id === "kilo" ? gatewayModel : "echo" })
  })
  expect(identities(backend.requests, Object.keys(hosted))).toEqual(hosted)
  // The upstream request identity is neither renamed nor dropped; only the Gateway removes it.
  const byok = backend.requests.filter((request) => request.provider === "byok")
  expect(byok.map((request) => request.headers.get("x-opencode-client"))).toEqual(byok.map(() => KiloApp.name))
  expect(names(backend.requests, "byok")).toEqual(names(backend.requests, "anthropic"))
  expect(names(backend.requests, "kilo")).toEqual([])
}, 60_000)

test("without the host, every provider gets the upstream identity", async () => {
  using backend = peer()
  await boot(backend.url, [], async (client, directory) => {
    for (const id of Object.keys(unhosted)) await prompt(client, directory, { providerID: id, id: "echo" })
  })
  expect(identities(backend.requests, Object.keys(unhosted))).toEqual(unhosted)
  expect(names(backend.requests, "byok")).toEqual([
    "x-opencode-client",
    "x-opencode-project",
    "x-opencode-session",
    "x-opencode-session-id",
  ])
}, 60_000)

test.each([
  [{}, "kilo2"],
  [{ KILO_CLIENT: "vscode" }, "vscode"],
  [{ OPENCODE_CLIENT: "desktop" }, "desktop"],
  [{ KILO_CLIENT: "jetbrains", OPENCODE_CLIENT: "desktop" }, "jetbrains"],
])("the client name of %o is the last segment of the client user agent", async (client, name) => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/request-identity.ts")], {
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
  expect(JSON.parse(stdout)).toEqual({ "User-Agent": `kilo/${OPENCODE_CHANNEL}/${OPENCODE_VERSION}/${name}` })
})

type Captured = { provider: string; headers: Headers }

// One identity per provider: every request of a provider (a WebSocket upgrade and its HTTP fallback, the step and
// the title) must carry the same one.
function identities(requests: Captured[], providers: string[]) {
  return Object.fromEntries(
    providers.map((id) => {
      const seen = requests
        .filter((request) => request.provider === id)
        .map((request) => ({
          userAgent: request.headers.get("user-agent"),
          referer: request.headers.get("http-referer"),
          title: request.headers.get("x-title"),
        }))
      const distinct = [...new Map(seen.map((item) => [JSON.stringify(item), item])).values()]
      return [id, distinct.length === 1 ? distinct[0] : distinct]
    }),
  )
}

function names(requests: Captured[], provider: string) {
  return [
    ...new Set(
      requests
        .filter((request) => request.provider === provider)
        .flatMap((request) => [...request.headers.keys()].filter((name) => name.startsWith("x-opencode-"))),
    ),
  ].sort()
}

async function prompt(
  client: ReturnType<typeof OpenCode.make>,
  directory: string,
  model: { providerID: string; id: string },
) {
  const session = await client.session.create({ location: { directory }, model })
  await client.session.prompt({ sessionID: session.id, text: "Say hello." })
  await client.session.wait({ sessionID: session.id })
}

// Requests under `/<provider>/` are model requests of that provider; `/api/` is the Kilo API and Gateway. A chat
// completion gets a minimal answer; every other model route is refused, which still records its headers.
function peer() {
  const requests: Captured[] = []
  const chunk = (input: object) => `data: ${JSON.stringify({ id: "chatcmpl-fixture", model: "echo", ...input })}\n\n`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/profile")
        return Response.json({ user: { email: "identity@example.test" }, organizations: [], hasPersonalAccount: true })
      if (pathname === "/api/defaults") return Response.json({ defaultModel: gatewayModel })
      if (pathname === "/api/gateway/v1/models")
        return Response.json({
          data: [
            {
              id: gatewayModel,
              name: "Kilo Auto Frontier",
              context_length: 200000,
              max_completion_tokens: 32000,
              supported_parameters: ["tools"],
              pricing: { prompt: "0.00001", completion: "0.00002" },
              isFree: false,
              opencode: { ai_sdk_provider: "openrouter" },
            },
          ],
        })
      const provider = pathname.startsWith("/api/gateway/") ? "kilo" : pathname.split("/")[1]
      if (pathname.startsWith("/api/") && provider !== "kilo") return new Response(null, { status: 404 })
      if (!pathname.endsWith("/chat/completions") && provider === "kilo") return new Response(null, { status: 404 })
      requests.push({ provider, headers: new Headers(request.headers) })
      if (!pathname.endsWith("/chat/completions"))
        return Response.json(
          { error: { type: "invalid_request_error", message: "The fixture refuses this route." } },
          { status: 400 },
        )
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
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-request-identity-"))
  const directory = path.join(root, "repo")
  await Bun.write(path.join(directory, ".keep"), "")
  // Keep the developer's Kilo account and client environment out of the Gateway request.
  const variables = {
    KILO_API_URL: url,
    KILO_API_KEY: "fixture-token",
    KILOCODE_TOKEN: undefined,
    KILO_AUTH_CONTENT: undefined,
    KILO_ORG_ID: undefined,
    KILO_AI_GATEWAY_URL: undefined,
    KILO_PLATFORM: undefined,
    KILOCODE_FEATURE: undefined,
    KILOCODE_VERSION: undefined,
    KILOCODE_EDITOR_NAME: undefined,
  }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  const loopback = (id: string) => ({ baseURL: `${url}/${id}/v1`, apiKey: "fixture-key" })
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
                  directory: path.join(root, "global"),
                  project: false,
                  content: JSON.stringify({
                    provider: {
                      // Built-in providers keep their own protocol and plugin; only the endpoint is the peer.
                      ...Object.fromEntries(
                        ["anthropic", "opencode", "openrouter", "azure", "openai", "github-copilot"].map((id) => [
                          id,
                          { options: loopback(id), models: { echo: { name: "Echo" } } },
                        ]),
                      ),
                      // A bring-your-own-key provider, and one whose config names its own referer and title.
                      byok: {
                        npm: "@ai-sdk/openai-compatible",
                        options: loopback("byok"),
                        models: { echo: { name: "Echo" } },
                      },
                      configured: {
                        npm: "@ai-sdk/openai-compatible",
                        options: {
                          ...loopback("configured"),
                          headers: { "HTTP-Referer": "https://configured.example", "X-Title": "Configured" },
                        },
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
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Fatal")),
    )
  } finally {
    apply(previous)
    await rm(root, { recursive: true, force: true })
  }
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}
