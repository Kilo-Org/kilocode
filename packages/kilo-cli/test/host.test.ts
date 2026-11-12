import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Flag } from "@opencode/core/flag"
import { Permission } from "@opencode/core/permission"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
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
          // Kilo Plan mode replaces the native one.
          expect(plugins.body.data).toContainEqual(
            expect.objectContaining({ id: "kilocode.plan", source: { type: "sdk" }, state: { status: "active" } }),
          )
          expect(plugins.body.data).not.toContainEqual(
            expect.objectContaining({ id: "opencode.plan", state: { status: "active" } }),
          )
          // The Kilo goal, with the agent's `goal` tool, replaces the native one.
          expect(plugins.body.data).toContainEqual(
            expect.objectContaining({ id: "kilocode.goal", source: { type: "sdk" }, state: { status: "active" } }),
          )
          expect(plugins.body.data).not.toContainEqual(
            expect.objectContaining({ id: "opencode.goal", state: { status: "active" } }),
          )
          // The host times each Kilo plugin activation for the startup ratchet.
          expect(KiloHost.activations.get("kilocode.gateway")).toBeNumber()

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

// The MCP servers the host starts see the Kilo client identity rather than upstream's: the connect
// handshake names `kilo`, and OAuth registration uses Kilo's product name and URI. Both come from the
// `Mcp.node` override, so this fails if that override stops reaching the server graph.
test("the server gives MCP servers the Kilo client identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-host-"))
  const initializes: { name?: string }[] = []
  const registrations: Record<string, unknown>[] = []
  const remote = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
        })
      if (request.method !== "POST") return new Response(null, { status: 404 })
      const text = await request.text()
      if (url.pathname === "/register") {
        registrations.push(JSON.parse(text))
        return Response.json({ client_id: "registered", redirect_uris: [] })
      }
      // Every initialize is recorded, including the OAuth challenge that asks the server for its metadata.
      const message = JSON.parse(text)
      if (message.method === "initialize") initializes.push(message.params?.clientInfo ?? {})
      // A 401 sends the connect attempt to OAuth.
      return new Response("Unauthorized", { status: 401 })
    },
  })
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
          const call = (method: string, route: string, body?: unknown) =>
            Effect.promise(async () => {
              const url = new URL(route, "http://kilo.local")
              url.searchParams.set("location[directory]", directory)
              const response = await handler(
                new Request(url, {
                  method,
                  headers: {
                    authorization: `Basic ${btoa("opencode:secret")}`,
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                  },
                  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                }),
              )
              return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
            })

          yield* call("PUT", "/api/experimental/mcp/hosted", {
            config: { type: "remote", url: remote.url.href },
          })
          yield* eventually(
            Effect.sync(() => initializes.length),
            (count) => count > 0,
          )
          expect(initializes.map((info) => info.name)).toContain("kilo")

          // The MCP server is registered as an OAuth integration; starting a login registers a client.
          const integrations = yield* eventually(
            call("GET", "/api/integration"),
            (result) => result.body.data?.some((item: { metadata?: { source?: string } }) => item.metadata?.source === "mcp"),
          )
          const integration = integrations.body.data.find(
            (item: { metadata?: { source?: string } }) => item.metadata?.source === "mcp",
          )
          const method = integration.methods.find((item: { type: string }) => item.type === "oauth")
          const attempt = yield* call("POST", `/api/integration/${integration.id}/connect/oauth`, {
            methodID: method.id,
          })
          expect(attempt.status).toBe(200)
          expect(attempt.body.data.url).toBeString()
          expect(registrations).toHaveLength(1)
          expect(registrations[0]).toMatchObject({ client_name: "Kilo", client_uri: "https://kilo.ai" })
          expect(initializes.map((info) => info.name)).toContain("Kilo")
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    remote.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

// The server discovers only the isolated internal v2 names. The upstream server without the host overrides
// keeps the upstream names (test/config in core).
test("the server reads kilo2.json and .kilo2 and ignores v1 and opencode config", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-host-")))
  const project = path.join(root, "repo")
  const files = {
    "kilo2.json": { username: "root-kilo2" },
    ".kilo2/kilo2.jsonc": { shell: "dot-kilo2" },
    "kilo.json": { username: "root-v1" },
    "kilo.jsonc": { username: "root-v1-jsonc" },
    ".kilo/kilo.jsonc": { shell: "dot-v1" },
    ".kilo/kilo2.jsonc": { shell: "dot-v1-v2-file" },
    "opencode.json": { username: "root-opencode" },
    ".opencode/opencode.json": { shell: "dot-opencode" },
    ".kilocode/kilo.json": { shell: "dot-kilocode" },
  }
  for (const [file, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true })
    await writeFile(path.join(project, file), JSON.stringify(value))
  }
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
                config: { directory: path.join(root, "global"), claude: false },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const entries = yield* Effect.promise(async () => {
            const url = new URL("/api/config", "http://kilo.local")
            url.searchParams.set("location[directory]", project)
            const response = await handler(
              new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
            )
            return (await response.json()) as { type: string; path?: string }[]
          })
          // The system directory cannot be turned off through server options, so keep only the project entries.
          const paths = entries.flatMap((entry) => (entry.path?.startsWith(project) ? [entry.path] : []))
          expect(paths.map((item) => path.relative(project, item).replaceAll("\\", "/"))).toEqual([
            "kilo2.json",
            ".kilo2/kilo2.jsonc",
            ".kilo2",
          ])
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

// The host supplies Kilo's hosted client document, so a server that supports CIMD receives Kilo's client ID and the
// loopback the document lists, with no dynamic registration. The document and callback come from the same
// `Mcp.node` override as the client identity.
test("the server offers the Kilo client document to MCP servers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-host-"))
  const registrations: Record<string, unknown>[] = []
  const remote = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          client_id_metadata_document_supported: true,
          token_endpoint_auth_methods_supported: ["none"],
        })
      if (request.method !== "POST") return new Response(null, { status: 404 })
      if (url.pathname === "/register") {
        registrations.push(JSON.parse(await request.text()))
        return Response.json({ client_id: "registered" })
      }
      // A 401 sends the connect attempt to OAuth.
      return new Response("Unauthorized", { status: 401 })
    },
  })
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
          const call = (method: string, route: string, body?: unknown) =>
            Effect.promise(async () => {
              const url = new URL(route, "http://kilo.local")
              url.searchParams.set("location[directory]", directory)
              const response = await handler(
                new Request(url, {
                  method,
                  headers: {
                    authorization: `Basic ${btoa("opencode:secret")}`,
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                  },
                  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                }),
              )
              return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
            })

          yield* call("PUT", "/api/experimental/mcp/hosted", {
            config: { type: "remote", url: remote.url.href },
          })
          const integrations = yield* eventually(call("GET", "/api/integration"), (result) =>
            result.body.data?.some((item: { metadata?: { source?: string } }) => item.metadata?.source === "mcp"),
          )
          const integration = integrations.body.data.find(
            (item: { metadata?: { source?: string } }) => item.metadata?.source === "mcp",
          )
          const method = integration.methods.find((item: { type: string }) => item.type === "oauth")
          const attempt = yield* call("POST", `/api/integration/${integration.id}/connect/oauth`, {
            methodID: method.id,
          })
          const url = new URL(attempt.body.data.url)
          expect(url.searchParams.get("client_id")).toBe("https://kilo.ai/docs/oauth/kilo/client.json")
          expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:19876/mcp/oauth/callback")
          expect(registrations).toHaveLength(0)
          // Release the loopback listener the attempt holds.
          yield* call("DELETE", `/api/integration/${integration.id}/connect/oauth/${attempt.body.data.attemptID}`)
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    remote.stop(true)
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

test("keeps scheduling on unless OPENCODE_FLAGS opts out explicitly", () => {
  expect(KiloHost.schedulingOverrides(undefined)).toBe("schedules")
  expect(KiloHost.schedulingOverrides("")).toBe("schedules")
  expect(KiloHost.schedulingOverrides("media_blob")).toBe("media_blob,schedules")
  expect(KiloHost.schedulingOverrides("-media_blob")).toBe("-media_blob,schedules")
  expect(KiloHost.schedulingOverrides("all")).toBe("all,schedules")
  // An explicit opt-out stays an escape hatch: it wins over the always-on default.
  expect(KiloHost.schedulingOverrides("-schedules")).toBe("-schedules")
  expect(KiloHost.schedulingOverrides("all,-schedules")).toBe("all,-schedules")
  expect(KiloHost.schedulingOverrides("-media_blob, -schedules")).toBe("-media_blob, -schedules")
})

test("turns scheduling on in release channels, even against a config that turns it off", () => {
  const off = new Document({
    type: "document",
    info: new Info({ experimental: new ConfigExperimental.Info({ schedules: false }) }),
  })
  for (const channel of ["latest", "beta"]) {
    expect(Flag.resolve({ entries: [], channel }).schedules.enabled).toBeFalse()
    expect(Flag.resolve({ entries: [off], channel, overrides: KiloHost.schedulingOverrides(undefined) }).schedules).toEqual({
      enabled: true,
      source: "env",
    })
    expect(
      Flag.resolve({ entries: [off], channel, overrides: KiloHost.schedulingOverrides("-schedules") }).schedules.enabled,
    ).toBeFalse()
  }
})
