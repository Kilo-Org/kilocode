import { describe, expect, spyOn, test } from "bun:test"
import { createServer } from "http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Telemetry, type McpAuthCompletedProperties, type McpAuthStartedProperties } from "@kilocode/kilo-telemetry"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Config } from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import * as KiloAuthTelemetry from "../../../src/kilocode/mcp/auth-telemetry"
import * as KiloOAuthCallback from "../../../src/kilocode/mcp-oauth-callback"
import type { McpMarketplaceItem } from "../../../src/kilocode/marketplace/schema"
import { McpAuth } from "../../../src/mcp/auth"
import { McpBrowser } from "../../../src/mcp/browser"
import { MCP } from "../../../src/mcp/index"
import { McpOAuthCallback } from "../../../src/mcp/oauth-callback"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

// The browser follows the authorization redirect back to the local callback, like a real one.
const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) =>
      Effect.tryPromise({
        try: () => fetch(url).then((response) => response.body?.cancel()),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)

const mcpTest = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node]), [
    [McpBrowser.node, browserLayer],
  ]),
)

type Mode = "ok" | "deny" | "bad-token"

function serveOAuthMcp(mode: Mode) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      let anonymous = false
      const protocol = new Server({ name: "auth-telemetry", version: "1.0.0" }, { capabilities: { tools: {} } })
      protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [] }))
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)

      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          if (url.pathname === "/mcp") {
            if (anonymous || request.headers.get("authorization") === "Bearer secret-access-token")
              return transport.handleRequest(request)
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
              },
            })
          }
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
          if (url.pathname === "/register") {
            const metadata: unknown = await request.json()
            if (!metadata || typeof metadata !== "object") return new Response("Invalid metadata", { status: 400 })
            return Response.json({ ...metadata, client_id: "test-client" }, { status: 201 })
          }
          if (url.pathname === "/authorize") {
            const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
            const state = url.searchParams.get("state")
            if (state) redirect.searchParams.set("state", state)
            if (mode === "deny") {
              redirect.searchParams.set("error", "access_denied")
              redirect.searchParams.set("error_description", "The user denied access to secret-workspace")
            } else redirect.searchParams.set("code", "secret-code")
            return Response.redirect(redirect, 302)
          }
          if (url.pathname === "/token") {
            if (mode === "bad-token")
              return Response.json(
                { error: "invalid_grant", error_description: "code secret-code expired" },
                { status: 400 },
              )
            return Response.json({ access_token: "secret-access-token", token_type: "Bearer", scope: "mcp" })
          }
          return new Response("Not found", { status: 404 })
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        allowAnonymous: () => {
          anonymous = true
        },
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

async function freePort() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const address = probe.address()
  if (!address || typeof address === "string") throw new Error("missing probe address")
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return address.port
}

const stopCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

// Telemetry delivery is the external boundary; record what the runtime would send.
function record() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const started: McpAuthStartedProperties[] = []
      const completed: McpAuthCompletedProperties[] = []
      const a = spyOn(Telemetry, "trackMcpAuthStarted").mockImplementation((props) => {
        started.push(props)
      })
      const b = spyOn(Telemetry, "trackMcpAuthCompleted").mockImplementation((props) => {
        completed.push(props)
      })
      return { started, completed, restore: () => (a.mockRestore(), b.mockRestore()) }
    }),
    (rec) => Effect.sync(rec.restore),
  )
}

// The terminal event must already be queued when `authenticate` returns, so a short-lived
// process such as `kilo mcp auth` cannot exit before sending it.
function completion(rec: { completed: McpAuthCompletedProperties[] }) {
  return Effect.sync(() => {
    expect(rec.completed).toHaveLength(1)
    const done = rec.completed.at(0)
    if (!done) throw new Error("MCP Auth Completed was not emitted")
    return done
  })
}

function addServer(name: string, url: string) {
  return Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp.add(name, { type: "remote", url })
    return mcp
  })
}

// No identifying or secret value may leave the process.
function expectSafe(props: object, values: string[]) {
  const text = JSON.stringify(props)
  for (const value of values) expect(text).not.toContain(value)
}

describe("MCP auth telemetry: real sign-in flows", () => {
  mcpTest.instance("a completed browser sign-in reports OAuth success and a connected server", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("private-server", server.url)

      const status = yield* awaitWithTimeout(mcp.authenticate("private-server"), "sign-in timed out", "5 seconds")
      const done = yield* completion(rec)

      expect(status).toEqual({ status: "connected" })
      expect(rec.started).toHaveLength(1)
      expect(rec.started[0]).toEqual({ schemaVersion: 1, attemptId: done.attemptId, external: false })
      expect(done).toMatchObject({
        outcome: "success",
        phase: "reconnect",
        oauthOutcome: "success",
        connectionOutcome: "connected",
        redirect: true,
        attribution: "unknown",
      })
      expect(done.errorCode).toBeUndefined()
      expect(done.itemId).toBeUndefined()
      expectSafe(done, ["private-server", server.url, "secret-code", "secret-access-token"])
    }),
  )

  mcpTest.instance("a connection that needs no redirect is not counted as an OAuth success", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("anonymous-server", server.url)
      server.allowAnonymous()

      expect((yield* mcp.authenticate("anonymous-server")).status).toBe("connected")
      expect(yield* completion(rec)).toMatchObject({
        outcome: "success",
        phase: "tool_discovery",
        oauthOutcome: "not_performed",
        connectionOutcome: "connected",
        redirect: false,
      })
    }),
  )

  mcpTest.instance("a denied consent is reported as denied with the protocol code only", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("deny")
      const mcp = yield* addServer("deny-server", server.url)

      const status = yield* awaitWithTimeout(mcp.authenticate("deny-server"), "sign-in timed out", "5 seconds")
      const done = yield* completion(rec)

      expect(status.status).toBe("failed")
      expect(done).toMatchObject({
        outcome: "denied",
        phase: "authorization",
        oauthOutcome: "failure",
        connectionOutcome: "not_attempted",
        errorCode: "access_denied",
      })
      expectSafe(done, ["secret-workspace", "deny-server"])
    }),
  )

  mcpTest.instance("a rejected token exchange is a failure in the token_exchange phase", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("bad-token")
      const mcp = yield* addServer("bad-token-server", server.url)

      const status = yield* awaitWithTimeout(mcp.authenticate("bad-token-server"), "sign-in timed out", "5 seconds")
      const done = yield* completion(rec)

      expect(status.status).toBe("failed")
      expect(done).toMatchObject({
        outcome: "failure",
        phase: "token_exchange",
        oauthOutcome: "failure",
        connectionOutcome: "not_attempted",
        errorCode: "invalid_grant",
      })
      expectSafe(done, ["secret-code", "expired"])
    }),
  )

  mcpTest.instance("cancelling an external sign-in is reported as cancelled, not failed", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("cancel-server", server.url)
      const events = yield* EventV2Bridge.Service
      const url = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((evt) => {
        if (evt.type === MCP.AuthUrl.type) Deferred.doneUnsafe(url, Effect.void)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const fiber = yield* mcp.authenticate("cancel-server", undefined, { external: true }).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(url), "authorization URL was not published", "5 seconds")
      yield* mcp.cancelAuth("cancel-server")
      const status = yield* awaitWithTimeout(Fiber.join(fiber), "cancel timed out", "5 seconds")
      const done = yield* completion(rec)

      // The user-facing result is unchanged by the named callback errors.
      expect(status).toEqual({ status: "failed", error: "Browser authorization failed: Authorization cancelled" })
      expect(rec.started[0]?.external).toBe(true)
      expect(done).toMatchObject({
        outcome: "cancelled",
        phase: "authorization",
        oauthOutcome: "not_reached",
        errorCode: "user_cancelled",
        external: true,
      })
    }),
  )

  mcpTest.instance("a sign-in displaced by a newer flow on another callback port is superseded", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const first = yield* serveOAuthMcp("ok")
      const second = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("waiting-server", first.url)
      const port = yield* Effect.promise(freePort)
      yield* mcp.add("newer-server", { type: "remote", url: second.url, oauth: { callbackPort: port } })
      const events = yield* EventV2Bridge.Service
      const url = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((evt) => {
        if (evt.type === MCP.AuthUrl.type) Deferred.doneUnsafe(url, Effect.void)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const waiting = yield* mcp.authenticate("waiting-server", undefined, { external: true }).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(url), "authorization URL was not published", "5 seconds")
      // The newer flow restarts the callback listener on its own port.
      const newer = yield* awaitWithTimeout(mcp.authenticate("newer-server"), "newer sign-in timed out", "5 seconds")
      const status = yield* awaitWithTimeout(Fiber.join(waiting), "displaced sign-in timed out", "5 seconds")

      expect(newer).toEqual({ status: "connected" })
      // The user-facing result is unchanged; only the telemetry category differs.
      expect(status).toEqual({ status: "failed", error: "Browser authorization failed: OAuth callback server stopped" })
      expect(rec.completed.find((done) => done.external)).toMatchObject({
        outcome: "superseded",
        phase: "authorization",
        oauthOutcome: "not_reached",
        errorCode: "superseded",
      })
      expect(rec.completed.find((done) => !done.external)).toMatchObject({ outcome: "success" })
    }),
  )

  mcpTest.instance("a server removed during sign-in keeps the OAuth success it reached", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("removed-server", server.url)
      const events = yield* EventV2Bridge.Service
      const url = yield* Deferred.make<string>()
      const unsubscribe = yield* events.listen((evt) => {
        const data: unknown = evt.data
        if (
          evt.type === MCP.AuthUrl.type &&
          data &&
          typeof data === "object" &&
          "url" in data &&
          typeof data.url === "string"
        )
          Deferred.doneUnsafe(url, Effect.succeed(data.url))
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const fiber = yield* mcp.authenticate("removed-server", undefined, { external: true }).pipe(Effect.forkScoped)
      const auth = yield* awaitWithTimeout(Deferred.await(url), "authorization URL was not published", "5 seconds")
      yield* mcp.remove("removed-server")
      yield* Effect.promise(() => fetch(auth).then((response) => response.body?.cancel()))
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "sign-in timed out", "5 seconds")
      const done = yield* completion(rec)

      expect(exit._tag).toBe("Failure")
      expect(done).toMatchObject({
        outcome: "failure",
        phase: "reconnect",
        oauthOutcome: "success",
        errorCode: "server_not_found",
      })
    }),
  )

  mcpTest.instance("an unknown server is reported once as server_not_found", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const mcp = yield* MCP.Service

      const exit = yield* Effect.exit(mcp.authenticate("missing-server"))
      const done = yield* completion(rec)

      expect(exit._tag).toBe("Failure")
      expect(rec.completed).toHaveLength(1)
      expect(done).toMatchObject({ outcome: "failure", phase: "prepare", errorCode: "server_not_found" })
    }),
  )

  mcpTest.instance("the two-step start/finish API emits no sign-in events", () =>
    Effect.gen(function* () {
      yield* stopCallback
      const rec = yield* record()
      const server = yield* serveOAuthMcp("ok")
      const mcp = yield* addServer("two-step-server", server.url)

      expect((yield* mcp.startAuth("two-step-server")).authorizationUrl).toContain("/authorize")
      expect((yield* mcp.finishAuth("two-step-server", "secret-code")).status).toBe("connected")
      expect(rec.started).toHaveLength(0)
      expect(rec.completed).toHaveLength(0)
    }),
  )
})

describe("MCP auth telemetry: config lookup", () => {
  const run = () => Effect.succeed({ status: "connected" })

  // The config lookup can end interrupted on its own, for example when the instance
  // initialisation it waits on is interrupted. That must abort the sign-in, not record one.
  mcpTest.instance("an interrupted lookup aborts before an attempt is recorded", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const exit = yield* Effect.exit(KiloAuthTelemetry.observe(run, () => Effect.interrupt)("server"))

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(rec.started).toHaveLength(0)
      expect(rec.completed).toHaveLength(0)
    }),
  )

  mcpTest.instance("a lookup that is both interrupted and failed still aborts", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const mixed = Cause.combine(Cause.interrupt(), Cause.fail(new Error("config unavailable")))
      const exit = yield* Effect.exit(KiloAuthTelemetry.observe(run, () => Effect.failCause(mixed))("server"))

      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(rec.started).toHaveLength(0)
    }),
  )

  // An interrupt landing right after the started event must still produce its completion,
  // so every `MCP Auth Started` has exactly one `MCP Auth Completed`.
  mcpTest.instance("an interrupt right after the started event still records the completion", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const track = spyOn(Telemetry, "trackMcpAuthStarted").mockImplementation((props) => {
        rec.started.push(props)
        Fiber.getCurrent()?.interruptUnsafe()
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => track.mockRestore()))

      // Run in its own fiber so the spy interrupts the sign-in, not the test.
      const fiber = yield* KiloAuthTelemetry.observe(run, () => Effect.succeed(undefined))("server").pipe(
        Effect.forkScoped,
      )
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(rec.started).toHaveLength(1)
      expect(rec.completed).toHaveLength(1)
      expect(rec.completed[0]).toMatchObject({
        attemptId: rec.started[0]?.attemptId,
        outcome: "interrupted",
        phase: "prepare",
        errorCode: "interrupted",
      })
    }),
  )

  mcpTest.instance("interrupting the caller during the lookup records no attempt", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const ready = yield* Deferred.make<void>()
      const lookup = () => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never))
      const fiber = yield* KiloAuthTelemetry.observe(run, lookup)("server").pipe(Effect.forkScoped)
      yield* Deferred.await(ready)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(rec.started).toHaveLength(0)
    }),
  )

  mcpTest.instance("a failed lookup only loses context; the sign-in still runs", () =>
    Effect.gen(function* () {
      const rec = yield* record()
      const status = yield* KiloAuthTelemetry.observe(run, () => Effect.fail(new Error("config unavailable")))("server")
      const done = yield* completion(rec)

      expect(status).toEqual({ status: "connected" })
      expect(rec.started).toHaveLength(1)
      expect(done.outcome).toBe("success")
    }),
  )
})

describe("MCP auth telemetry: classification", () => {
  test("OAuth errors map to allowlisted protocol codes, never their text", () => {
    expect(KiloAuthTelemetry.classify(new InvalidGrantError("code abc123 expired"))).toBe("invalid_grant")
    expect(KiloAuthTelemetry.classify(KiloOAuthCallback.denied("nope", "access_denied"))).toBe("access_denied")
    expect(KiloAuthTelemetry.classify(KiloOAuthCallback.denied("nope", "made_up_code"))).toBe("oauth_error")
    expect(KiloAuthTelemetry.classify(new Error("https://private.example.com failed"))).toBe("unknown")
    expect(KiloAuthTelemetry.classify("string")).toBe("unknown")
  })

  test("config problems known before the flow are named", () => {
    expect(KiloAuthTelemetry.setup(undefined)).toBe("server_not_found")
    expect(KiloAuthTelemetry.setup({ type: "local" })).toBe("unsupported_transport")
    expect(KiloAuthTelemetry.setup({ type: "remote", url: "https://x.test/mcp", oauth: false })).toBe("oauth_disabled")
    expect(KiloAuthTelemetry.setup({ type: "remote", url: "not a url" })).toBe("invalid_configuration")
    expect(KiloAuthTelemetry.setup({ type: "remote", url: "https://x.test/mcp" })).toBeUndefined()
  })

  test("callback failures are recognized by the predicates telemetry uses", () => {
    expect(KiloOAuthCallback.isCancelled(KiloOAuthCallback.cancelled())).toBe(true)
    expect(KiloOAuthCallback.isExpired(KiloOAuthCallback.expired())).toBe(true)
    expect(KiloOAuthCallback.isStopped(KiloOAuthCallback.stopped())).toBe(true)
    expect(KiloOAuthCallback.isDisplaced(KiloOAuthCallback.displaced())).toBe(true)
    expect(KiloOAuthCallback.isStopped(KiloOAuthCallback.displaced())).toBe(false)
    expect(KiloOAuthCallback.displaced().message).toBe(KiloOAuthCallback.stopped().message)
    expect(KiloOAuthCallback.isCancelled(new Error("Authorization cancelled"))).toBe(false)
  })

  test("the user-facing callback messages are unchanged", () => {
    expect(KiloOAuthCallback.cancelled().message).toBe("Authorization cancelled")
    expect(KiloOAuthCallback.expired().message).toBe("OAuth callback timeout - authorization took too long")
    expect(KiloOAuthCallback.stopped().message).toBe("OAuth callback server stopped")
    expect(KiloOAuthCallback.denied("Access denied", "access_denied").message).toBe("Access denied")
  })
})

describe("MCP auth telemetry: marketplace attribution", () => {
  const item = (
    content: McpMarketplaceItem["content"],
    extra: Partial<McpMarketplaceItem> = {},
  ): McpMarketplaceItem => ({
    type: "mcp",
    id: "linear",
    name: "Linear",
    description: "Linear MCP",
    category: "productivity",
    url: "https://linear.app",
    content,
    ...extra,
  })

  test("a config whose key and URL match a catalog method is verified", () => {
    const catalog = [
      item('{"url":"https://mcp.linear.app/mcp"}', { oauthRequirement: "required", authHandler: "kilo" }),
    ]
    expect(KiloAuthTelemetry.match(catalog, "linear", "https://mcp.linear.app/mcp")).toEqual({
      attribution: "verified",
      itemType: "mcp",
      itemId: "linear",
      methodId: "default",
      oauthRequirement: "required",
      authHandler: "kilo",
    })
  })

  test("a matching name with a different URL stays unknown", () => {
    const catalog = [item('{"url":"https://mcp.linear.app/mcp"}')]
    expect(KiloAuthTelemetry.match(catalog, "linear", "https://evil.example.com/mcp")).toEqual({
      attribution: "unknown",
    })
    expect(KiloAuthTelemetry.match(catalog, "my-linear", "https://mcp.linear.app/mcp")).toEqual({
      attribution: "unknown",
    })
  })

  test("install parameters match one URL segment and the resolved method is reported", () => {
    const catalog = [
      item([
        { id: "local", name: "Local", content: '{"command":"npx","args":["linear-mcp"]}' },
        {
          id: "tenant",
          name: "Hosted",
          content: '{"url":"https://{{TENANT}}.linear.app/mcp"}',
          oauthRequirement: "surprising",
        },
      ]),
    ]
    expect(KiloAuthTelemetry.match(catalog, "linear", "https://acme.linear.app/mcp")).toEqual({
      attribution: "verified",
      itemType: "mcp",
      itemId: "linear",
      methodId: "tenant",
      methodName: "Hosted",
      oauthRequirement: "unknown",
    })
    expect(KiloAuthTelemetry.match(catalog, "linear", "https://evil.com/x.linear.app/mcp").attribution).toBe("unknown")
  })

  test("methods sharing a URL verify the item but not the method", () => {
    const catalog = [
      item([
        { name: "Read", content: '{"url":"https://mcp.linear.app/mcp"}' },
        { name: "Write", content: '{"url":"https://mcp.linear.app/mcp","headers":{"x":"y"}}' },
      ]),
    ]
    expect(KiloAuthTelemetry.match(catalog, "linear", "https://mcp.linear.app/mcp")).toEqual({
      attribution: "verified",
      itemType: "mcp",
      itemId: "linear",
    })
  })

  test("attribution never fetches the catalog while telemetry is disabled", async () => {
    expect(Telemetry.isEnabled()).toBe(false)
    expect(await KiloAuthTelemetry.attribute("linear", { type: "remote", url: "https://mcp.linear.app/mcp" })).toEqual({
      attribution: "unknown",
    })
  })
})
