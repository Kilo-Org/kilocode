import { describe, expect, spyOn } from "bun:test"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { Config } from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { McpAuth } from "../../../src/mcp/auth"
import { MCP } from "../../../src/mcp/index"
import { McpOAuthCallback } from "../../../src/mcp/oauth-callback"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

const mcpTest = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node])),
)

const stopCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

interface MockServer {
  url: string
  sseProbes: () => number
  close: () => Promise<void>
}

interface HardFailureServer {
  url: string
  reset: () => void
  posts: () => number
  gets: () => number
  close: () => Promise<void>
}

// OAuth discovery, dynamic registration, and authorization endpoints shared by both mock servers.
// The sign-in flow only builds the /authorize URL; it never follows the redirect in these tests.
async function oauthRoute(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)
  const origin = url.origin
  if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
    return Response.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["mcp"],
    })
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return Response.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      scopes_supported: ["mcp"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    })
  if (url.pathname === "/register" && request.method === "POST") {
    const metadata = await request.json()
    return Response.json(Object.assign({}, metadata, { client_id: "test-client" }), { status: 201 })
  }
  if (url.pathname === "/authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "http://127.0.0.1/callback")
    const state = url.searchParams.get("state")
    if (state) redirect.searchParams.set("state", state)
    redirect.searchParams.set("code", "test-code")
    return Response.redirect(redirect, 302)
  }
  if (url.pathname === "/token" && request.method === "POST")
    return Response.json({ access_token: "test-access-token", token_type: "Bearer", scope: "mcp" })
  return undefined
}

// A legacy SSE-only gateway like the nvidia server: POST initialize is rejected with 405, while
// the GET event stream answers 401 with WWW-Authenticate, which is the SDK's OAuth entry point.
function serveLegacySseOAuth() {
  return Effect.acquireRelease(
    Effect.promise(async (): Promise<MockServer> => {
      let sseProbes = 0
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          if (url.pathname === "/mcp") {
            if (request.method === "POST") return new Response("Method Not Allowed", { status: 405 })
            if (request.headers.get("accept")?.includes("text/event-stream")) {
              sseProbes++
              return new Response("Unauthorized", {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
                },
              })
            }
            return new Response("Method Not Allowed", { status: 405 })
          }
          const oauth = await oauthRoute(request)
          if (oauth) return oauth
          return new Response("Not found", { status: 404 })
        },
      })
      return {
        url: new URL("/mcp", http.url).toString(),
        sseProbes: () => sseProbes,
        close: () => http.stop(true),
      }
    }),
    (server) => Effect.promise(() => server.close()),
  )
}

// A standard StreamableHTTP OAuth server: GET is not offered, and POST initialize returns 401.
// The first transport candidate must start OAuth on its own, without an SSE fallback attempt.
function serveStandardStreamableOAuth() {
  return Effect.acquireRelease(
    Effect.promise(async (): Promise<MockServer> => {
      let sseProbes = 0
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          if (url.pathname === "/mcp") {
            if (request.method === "GET") {
              sseProbes++
              return new Response(null, { status: 405 })
            }
            if (!request.headers.get("authorization"))
              return new Response("Unauthorized", {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
                },
              })
            return new Response("Not found", { status: 404 })
          }
          const oauth = await oauthRoute(request)
          if (oauth) return oauth
          return new Response("Not found", { status: 404 })
        },
      })
      return {
        url: new URL("/mcp", http.url).toString(),
        sseProbes: () => sseProbes,
        close: () => http.stop(true),
      }
    }),
    (server) => Effect.promise(() => server.close()),
  )
}

// A server that rejects every transport candidate: the POST initialize answers 405 and the GET
// event-stream probe answers 501, neither with an OAuth challenge, so sign-in must surface the
// last transport's error instead of keeping the caller waiting for a redirect that can never come.
function serveHardFailure() {
  return Effect.acquireRelease(
    Effect.promise(async (): Promise<HardFailureServer> => {
      let posts = 0
      let gets = 0
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/mcp") {
            if (request.method === "POST") {
              posts++
              return new Response("POST Method Not Allowed", { status: 405 })
            }
            gets++
            return new Response("Event stream not offered", { status: 501 })
          }
          const oauth = await oauthRoute(request)
          if (oauth) return oauth
          return new Response("Not found", { status: 404 })
        },
      })
      return {
        url: new URL("/mcp", http.url).toString(),
        reset: () => {
          posts = 0
          gets = 0
        },
        posts: () => posts,
        gets: () => gets,
        close: () => http.stop(true),
      }
    }),
    (server) => Effect.promise(() => server.close()),
  )
}

// Count transport close() calls while keeping the original resource cleanup intact. Distinct
// instances are tracked separately because the SDK's Client.connect closes a failed transport on
// its own, so our release's close records a second hit for the same instance.
function spyTransportCloses() {
  const streamable = { count: 0 }
  const sse = { count: 0 }
  const streamableInstances = new Map<unknown, number>()
  const sseInstances = new Map<unknown, number>()
  // oxlint-disable-next-line typescript-eslint/unbound-method -- captured only to call through with the spy's this
  const streamableOriginal = StreamableHTTPClientTransport.prototype.close
  // oxlint-disable-next-line typescript-eslint/unbound-method -- captured only to call through with the spy's this
  const sseOriginal = SSEClientTransport.prototype.close
  const streamableSpy = spyOn(StreamableHTTPClientTransport.prototype, "close").mockImplementation(function (
    this: StreamableHTTPClientTransport,
  ) {
    streamable.count++
    streamableInstances.set(this, (streamableInstances.get(this) ?? 0) + 1)
    return streamableOriginal.call(this)
  })
  const sseSpy = spyOn(SSEClientTransport.prototype, "close").mockImplementation(function (this: SSEClientTransport) {
    sse.count++
    sseInstances.set(this, (sseInstances.get(this) ?? 0) + 1)
    return sseOriginal.call(this)
  })
  return {
    streamable,
    sse,
    streamableInstances,
    sseInstances,
    restore: () => (streamableSpy.mockRestore(), sseSpy.mockRestore()),
  }
}

describe("MCP startAuth SSE fallback", () => {
  mcpTest.instance("a 405 on POST initialize falls back to the SSE transport and starts OAuth", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const server = yield* serveLegacySseOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("legacy-sse-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("legacy-sse-server").pipe(Effect.ignore))

      const result = yield* awaitWithTimeout(mcp.startAuth("legacy-sse-server"), "startAuth timed out", "10 seconds")

      expect(result.authorizationUrl).toContain("/authorize")
      expect(server.sseProbes()).toBeGreaterThanOrEqual(1)
    }),
  )

  mcpTest.instance("a standard StreamableHTTP 401 starts OAuth without trying the SSE fallback", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const server = yield* serveStandardStreamableOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("standard-streamable-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("standard-streamable-server").pipe(Effect.ignore))

      const result = yield* awaitWithTimeout(
        mcp.startAuth("standard-streamable-server"),
        "startAuth timed out",
        "10 seconds",
      )

      expect(result.authorizationUrl).toContain("/authorize")
      expect(server.sseProbes()).toBe(0)
    }),
  )

  mcpTest.instance("a server that rejects every transport fails with the last error instead of hanging", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const server = yield* serveHardFailure()
      const mcp = yield* MCP.Service
      yield* mcp.add("hard-failure-server", { type: "remote", url: server.url })
      // add() itself runs the connection probe; discard those requests so only startAuth's attempts count.
      server.reset()

      const exit = yield* Effect.exit(
        awaitWithTimeout(mcp.startAuth("hard-failure-server"), "startAuth timed out", "10 seconds"),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected startAuth to fail")
      const message = String(Cause.squash(exit.cause))
      expect(message).toContain("501")
      expect(message).not.toContain("405")
      expect(server.posts()).toBeGreaterThanOrEqual(1)
      expect(server.gets()).toBeGreaterThanOrEqual(1)
    }),
  )

  mcpTest.instance("an interrupted browser wait releases the pending flow", () =>
    Effect.gen(function* () {
      const closes = spyTransportCloses()
      yield* Effect.addFinalizer(() => Effect.sync(() => closes.restore()))
      const cancelSpy = spyOn(McpOAuthCallback, "cancelPendingState").mockImplementation(() => {})
      yield* Effect.addFinalizer(() => Effect.sync(() => cancelSpy.mockRestore()))
      yield* stopCallback
      const server = yield* serveLegacySseOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("interrupted-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("interrupted-server").pipe(Effect.ignore))

      const events = yield* EventV2Bridge.Service
      const url = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((evt) => {
        if (evt.type === MCP.AuthUrl.type) Deferred.doneUnsafe(url, Effect.void)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const fiber = yield* mcp.authenticate("interrupted-server", undefined, { external: true }).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(url), "authorization URL was not published", "10 seconds")

      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected the interrupted sign-in to fail")
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)

      expect(cancelSpy).toHaveBeenCalled()
      expect(cancelSpy.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/))

      expect(closes.streamable.count).toBeGreaterThanOrEqual(1)
      expect(closes.sse.count).toBeGreaterThanOrEqual(1)

      const retry = yield* awaitWithTimeout(mcp.startAuth("interrupted-server"), "startAuth timed out", "10 seconds")
      expect(retry.authorizationUrl).toContain("/authorize")
    }),
  )

  mcpTest.instance("a throwing authorization callback releases the pending flow and its callback timer", () =>
    Effect.gen(function* () {
      const closes = spyTransportCloses()
      yield* Effect.addFinalizer(() => Effect.sync(() => closes.restore()))
      const cancelSpy = spyOn(McpOAuthCallback, "cancelPendingState").mockImplementation(() => {})
      yield* Effect.addFinalizer(() => Effect.sync(() => cancelSpy.mockRestore()))
      yield* stopCallback
      const server = yield* serveLegacySseOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("throwing-callback-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("throwing-callback-server").pipe(Effect.ignore))

      const sseBefore = closes.sse.count
      const fiber = yield* mcp
        .authenticate(
          "throwing-callback-server",
          () => {
            throw new Error("authorization callback boom")
          },
          { external: true },
        )
        .pipe(Effect.forkScoped)

      const exit = yield* Effect.exit(
        awaitWithTimeout(Fiber.join(fiber), "authenticate with a throwing callback timed out", "10 seconds"),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected the throwing sign-in to fail")

      expect(cancelSpy).toHaveBeenCalled()
      expect(cancelSpy.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/))

      expect(closes.sse.count).toBeGreaterThan(sseBefore)

      const retry = yield* awaitWithTimeout(
        mcp.startAuth("throwing-callback-server"),
        "startAuth timed out",
        "10 seconds",
      )
      expect(retry.authorizationUrl).toContain("/authorize")
    }),
  )

  mcpTest.instance("removeAuth releases a pending sign-in flow", () =>
    Effect.gen(function* () {
      const closes = spyTransportCloses()
      yield* Effect.addFinalizer(() => Effect.sync(() => closes.restore()))
      yield* stopCallback
      const server = yield* serveLegacySseOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("remove-auth-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("remove-auth-server").pipe(Effect.ignore))

      const first = yield* awaitWithTimeout(mcp.startAuth("remove-auth-server"), "startAuth timed out", "10 seconds")
      expect(first.authorizationUrl).toContain("/authorize")

      const sseBeforeRemove = closes.sse.count
      yield* mcp.removeAuth("remove-auth-server")
      expect(closes.sse.count).toBeGreaterThan(sseBeforeRemove)

      const second = yield* awaitWithTimeout(mcp.startAuth("remove-auth-server"), "startAuth timed out", "10 seconds")
      expect(second.authorizationUrl).toContain("/authorize")
    }),
  )

  mcpTest.instance("concurrent sign-ins for one server both succeed without orphaning the flow", () =>
    Effect.gen(function* () {
      const closes = spyTransportCloses()
      yield* Effect.addFinalizer(() => Effect.sync(() => closes.restore()))
      yield* stopCallback
      const server = yield* serveLegacySseOAuth()
      const mcp = yield* MCP.Service
      yield* mcp.add("concurrent-server", { type: "remote", url: server.url })
      yield* Effect.addFinalizer(() => mcp.cancelAuth("concurrent-server").pipe(Effect.ignore))

      const [firstFiber, secondFiber] = yield* Effect.all([
        mcp.startAuth("concurrent-server").pipe(Effect.forkScoped),
        mcp.startAuth("concurrent-server").pipe(Effect.forkScoped),
      ])
      const [firstExit, secondExit] = yield* Effect.all([
        Effect.exit(awaitWithTimeout(Fiber.join(firstFiber), "first startAuth timed out", "10 seconds")),
        Effect.exit(awaitWithTimeout(Fiber.join(secondFiber), "second startAuth timed out", "10 seconds")),
      ])

      expect(Exit.isSuccess(firstExit)).toBe(true)
      expect(Exit.isSuccess(secondExit)).toBe(true)
      if (!Exit.isSuccess(firstExit) || !Exit.isSuccess(secondExit))
        throw new Error("expected both concurrent sign-ins to succeed")
      expect(firstExit.value.authorizationUrl).toContain("/authorize")
      expect(secondExit.value.authorizationUrl).toContain("/authorize")

      // Three StreamableHTTP candidates were created in total: add()'s own connect probe plus one
      // per startAuth flow. All three 405 out and every instance must have been released. The SDK's
      // Client.connect also closes a failed transport itself, so raw close() calls are twice the
      // instance count; asserting distinct closed instances is the leak-proof check.
      expect(closes.streamableInstances.size).toBe(3)
      for (const hits of closes.streamableInstances.values()) expect(hits).toBeGreaterThanOrEqual(1)
      // The connect-probe SSE (closed on its 401 connect failure and again when the first flow takes
      // over) and the loser flow's SSE (closed by the synchronous replacement) are both released.
      // The final owner stays open until the cancelAuth finalizer registered above closes it.
      expect(closes.sseInstances.size).toBe(2)
      for (const hits of closes.sseInstances.values()) expect(hits).toBeGreaterThanOrEqual(1)
    }),
  )
})
