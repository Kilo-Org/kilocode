import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { authFailure } from "@opencode/core/kilocode/mcp/auth-failure"
import { McpClientMetadata } from "@opencode/core/kilocode/mcp/client-metadata"
import { KiloMcpRefresh } from "@opencode/core/kilocode/mcp/refresh"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpPool } from "@opencode/core/mcp/pool"
import { AbsolutePath } from "@opencode/core/schema"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { hostEnvironmentLayer } from "../../fixture/environment"
import { location, tempLocationLayer } from "../../fixture/location"
import { echoMcpHandler } from "../../fixture/mcp-echo"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Bus.node, Credential.node, Environment.node, Form.node, Integration.node, McpPool.node]),
    [Location.node.replace(tempLocationLayer), Environment.node.replace(hostEnvironmentLayer)],
  ),
)
const oauth = { ...McpClientMetadata.oauth, beforeConnect: KiloMcpRefresh.beforeConnect }

const open = Effect.fnUntraced(function* (config: ConfigMCP.Remote, directory: string) {
  const context = yield* Layer.build(
    Mcp.layer({ host: { oauth, authFailure } }).pipe(
      Layer.provide(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ),
    ),
  )
  const mcp = Context.get(context, Mcp.Service)
  yield* mcp.add("fixture", { ...config, disabled: true })
  if (!config.disabled) yield* mcp.connect("fixture")
  const [server] = yield* mcp.servers()
  return server
})
const fresh = (expiresIn = 3600) =>
  Response.json({
    access_token: "fresh",
    token_type: "Bearer",
    refresh_token: "rotated",
    expires_in: expiresIn,
    scope: "read",
  })

const fixture = Effect.fnUntraced(function* (
  respond: (request: Request) => Promise<Response> | Response,
  options: { expires: number; startup?: number; stallDiscovery?: boolean; metadata?: "configured" | "mismatched" },
) {
  const received: Array<string | null> = []
  const grants: URLSearchParams[] = []
  const paths: string[] = []
  const issuer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      paths.push(url.pathname)
      if (url.pathname === (options.metadata ? "/metadata" : "/.well-known/oauth-authorization-server")) {
        if (options.stallDiscovery) return respond(request)
        return Response.json({
          issuer: options.metadata === "mismatched" ? `${url.origin}/other` : url.origin,
          authorization_endpoint: `${url.origin}/login`,
          token_endpoint: `${url.origin}/exchange`,
          response_types_supported: ["code"],
        })
      }
      if (url.pathname !== "/exchange") return new Response(null, { status: 404 })
      grants.push(new URLSearchParams(await request.text()))
      return respond(request)
    },
  })
  yield* Effect.addFinalizer(() => Effect.promise(() => issuer.stop(true)))
  const echo = echoMcpHandler()
  const remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      received.push(request.headers.get("authorization"))
      return request.headers.get("authorization") === "Bearer fresh"
        ? echo.fetch(request)
        : Response.json({ error: "auth_invalid" }, { status: 403 })
    },
  })
  yield* Effect.addFinalizer(() => Effect.promise(() => remote.stop(true)))
  const config = new ConfigMCP.Remote({
    type: "remote",
    url: new URL("/mcp", remote.url).href,
    ...(options.metadata && { oauth: { auth_server_metadata_url: `${issuer.url.origin}/metadata` } }),
    timeout: { startup: options.startup ?? 30_000 },
  })
  const credentials = yield* Credential.Service
  const registered = yield* Effect.scoped(open({ ...config, disabled: true }, import.meta.dir))
  if (!registered?.integrationID) throw new Error("expected a remote OAuth integration")
  const row = yield* credentials.create({
    integrationID: registered.integrationID,
    value: {
      type: "oauth",
      methodID: Integration.MethodID.make("oauth"),
      access: "old",
      refresh: "original",
      expires: options.expires,
      metadata: {
        serverUrl: config.url,
        issuer: issuer.url.origin,
        client: { client_id: "fixture", issuer: issuer.url.origin },
      },
    },
  })
  return {
    connect: (directory: string, startup = config.timeout?.startup) =>
      Effect.scoped(open({ ...config, timeout: { startup } }, directory)).pipe(Effect.map((s) => s.status.status)),
    received,
    paths,
    grants,
    row,
    config,
    read: credentials.get(row.id).pipe(Effect.map((info) => info?.value)),
  }
})

it.live("refreshes once against the stored issuer before either worktree sends its first MCP request", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const joining = Promise.withResolvers<void>()
    const credentials = yield* Credential.Service
    const f = yield* fixture(
      async () => {
        entered.resolve()
        await release.promise
        // Still due after the exchange: merely serializing the two refreshes would spend the rotated token again.
        return fresh(20)
      },
      { expires: Date.now() - 1000 },
    )
    const first = yield* f.connect("/checkout").pipe(Effect.forkScoped)
    yield* Effect.promise(() => entered.promise)
    const second = yield* f.connect("/worktree").pipe(
      Effect.provideService(Credential.Service, {
        ...credentials,
        refresh: (id, input) => Effect.sync(joining.resolve).pipe(Effect.andThen(credentials.refresh(id, input))),
      }),
      Effect.forkScoped,
    )
    yield* Effect.promise(() => joining.promise)
    expect(f.received).toEqual([])
    release.resolve()
    expect(yield* Fiber.join(first)).toBe("connected")
    expect(yield* Fiber.join(second)).toBe("connected")
    expect(f.grants.map((grant) => Object.fromEntries(grant))).toEqual([
      { grant_type: "refresh_token", refresh_token: "original", client_id: "fixture", resource: f.config.url },
    ])
    expect(new Set(f.received)).toEqual(new Set(["Bearer fresh"]))
    const stored = yield* f.read
    expect(stored).toMatchObject({
      access: "fresh",
      refresh: "rotated",
      metadata: { ...f.row.value.metadata, scope: "read" },
    })
    expect(stored?.type === "oauth" && stored.expires).toBeGreaterThan(Date.now())
  }),
)

it.live("uses the configured metadata document and does not refresh a zero-lifetime response on reconnect", () =>
  Effect.gen(function* () {
    const f = yield* fixture(() => fresh(0), { expires: 1, metadata: "configured" })
    expect(yield* f.connect("/checkout")).toBe("connected")
    expect(yield* f.read).toMatchObject({ access: "fresh", expires: 0 })
    expect(yield* f.connect("/worktree")).toBe("connected")
    expect(f.paths).toEqual(["/metadata", "/exchange"])
  }),
)

it.live("never sends the refresh grant when configured metadata names another issuer", () =>
  Effect.gen(function* () {
    const f = yield* fixture(() => fresh(), { expires: 1, metadata: "mismatched" })
    expect(yield* f.connect("/checkout")).toBe("needs_auth")
    expect(f.paths).toEqual(["/metadata"])
    expect(yield* f.read).toEqual(f.row.value)
  }),
)

it.live("falls back to the normal MCP request when only the credential refresh store fails", () =>
  Effect.gen(function* () {
    const f = yield* fixture(() => fresh(), { expires: 1 })
    const credentials = yield* Credential.Service
    expect(
      yield* f.connect("/checkout").pipe(
        Effect.provideService(Credential.Service, {
          ...credentials,
          refresh: () => Effect.die(new Error("credential lock unavailable")),
        }),
      ),
    ).toBe("needs_auth")
    expect(f.received).toEqual(["Bearer old"])
    expect(yield* f.read).toEqual(f.row.value)
  }),
)

it.live("does not send a fallback MCP request when the connect is interrupted", () =>
  Effect.gen(function* () {
    const f = yield* fixture(() => fresh(), { expires: 1 })
    const credentials = yield* Credential.Service
    const exit = yield* f
      .connect("/checkout")
      .pipe(Effect.provideService(Credential.Service, { ...credentials, refresh: () => Effect.interrupt }), Effect.exit)
    expect(Exit.hasInterrupts(exit)).toBe(true)
    expect(f.received).toEqual([])
  }),
)

it.live("a worktree with a shorter connect timeout does not cancel the shared refresh", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const f = yield* fixture(
      async () => {
        entered.resolve()
        await release.promise
        return fresh()
      },
      { expires: Date.now() + 15_000 },
    )
    const owner = yield* f.connect("/checkout").pipe(Effect.forkScoped)
    yield* Effect.promise(() => entered.promise)
    expect(yield* f.connect("/worktree", 200)).toBe("needs_auth")
    expect(yield* f.read).toEqual(f.row.value)
    release.resolve()
    expect(yield* Fiber.join(owner)).toBe("connected")
    expect(f.grants).toHaveLength(1)
  }),
)

for (const phase of ["issuer discovery", "configured metadata", "token exchange"]) {
  const stallDiscovery = phase !== "token exchange"
  it.effect(`aborts stalled ${phase} at the connect deadline and retries on the next connect`, () =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>()
      const aborted = Promise.withResolvers<void>()
      let attempts = 0
      const f = yield* fixture(
        (request) => {
          attempts++
          if (attempts > 1) return stallDiscovery ? new Response(null, { status: 503 }) : fresh()
          entered.resolve()
          return new Promise<Response>((resolve) =>
            request.signal.addEventListener(
              "abort",
              () => {
                aborted.resolve()
                resolve(new Response())
              },
              { once: true },
            ),
          )
        },
        {
          expires: 1,
          startup: 800,
          stallDiscovery,
          metadata: phase === "configured metadata" ? "configured" : undefined,
        },
      )
      const first = yield* f.connect("/checkout").pipe(Effect.forkScoped)
      yield* Effect.promise(() => entered.promise)
      yield* TestClock.adjust(799)
      expect(f.received).toEqual([])
      yield* TestClock.adjust(1)
      expect(yield* Fiber.join(first)).toBe("needs_auth")
      yield* Effect.promise(() => aborted.promise)
      expect(yield* f.read).toEqual(f.row.value)
      expect(f.received).toEqual(["Bearer old"])
      expect(yield* f.connect("/worktree")).toBe(stallDiscovery ? "needs_auth" : "connected")
      expect(attempts).toBe(2)
    }),
  )
}

it.effect(
  "refreshes at the 30-second boundary, preserves the row on invalid_grant, and skips ineligible credentials",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(() => Response.json({ error: "invalid_grant" }, { status: 400 }), { expires: 30_000 })
      const credentials = yield* Credential.Service
      expect(yield* f.connect("/checkout")).toBe("needs_auth")
      expect(f.grants).toHaveLength(1)
      expect(yield* f.read).toEqual(f.row.value)
      if (f.row.value.type !== "oauth") throw new Error("expected OAuth fixture")
      for (const overrides of [
        { expires: 30_001 },
        { expires: 0 },
        { refresh: "" },
        { metadata: { client: { client_id: "unbound" } } },
        { metadata: { ...f.row.value.metadata, client: { client_id: "other", issuer: "https://other.invalid" } } },
      ]) {
        const value = { ...f.row.value, ...overrides }
        yield* credentials.update(f.row.id, { value })
        expect(yield* f.connect("/checkout")).toBe("needs_auth")
        expect(yield* f.read).toEqual(value)
      }
      yield* credentials.remove(f.row.id)
      expect(yield* f.connect("/checkout")).toBe("needs_auth")
      expect(f.grants).toHaveLength(1)
    }),
)
