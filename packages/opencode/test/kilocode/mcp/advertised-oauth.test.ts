// kilocode_change - new file: `kilo mcp auth` must start OAuth on servers that accept anonymous
// connections but advertise RFC 9728 protected-resource metadata (Kilo-Org/kilocode#15492)
import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Option } from "effect"
import { Config } from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { McpAuth } from "../../../src/mcp/auth"
import { McpBrowser } from "../../../src/mcp/browser"
import { MCP } from "../../../src/mcp/index"
import { McpOAuthCallback } from "../../../src/mcp/oauth-callback"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

const browsers = new Map<string, Deferred.Deferred<string>>()

const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) =>
      Effect.gen(function* () {
        const opened = browsers.get(new URL(url).origin)
        if (!opened) return yield* Effect.fail(new Error(`Unexpected browser URL: ${url}`))
        Deferred.doneUnsafe(opened, Effect.succeed(url))
        yield* Effect.tryPromise({
          try: () => fetch(url).then((response) => response.body?.cancel()),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }),
  }),
)

const mcpTest = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node]), [
    [McpBrowser.node, browserLayer],
  ]),
)

interface Options {
  /** Publish protected-resource metadata at the path-suffixed well-known URL, as Google does. */
  metadata: boolean
  /** Offer dynamic client registration on the authorization server. */
  registration: boolean
}

/**
 * A remote MCP server that answers every request, authenticated or not, with `200`, like
 * `https://drivemcp.googleapis.com/mcp/v1`. Each request gets a fresh stateless protocol server so
 * repeated `initialize` calls from add, auth, and reconnect all succeed.
 */
const serveAnonymousMcp = (options: Options) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: Array<{ pathname: string; authorization: string | null }> = []
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          requests.push({ pathname: url.pathname, authorization: request.headers.get("authorization") })

          if (url.pathname === "/mcp/v1") {
            const protocol = new Server({ name: "anonymous", version: "1.0.0" }, { capabilities: { tools: {} } })
            protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [] }))
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            })
            await protocol.connect(transport)
            return transport.handleRequest(request)
          }

          if (options.metadata && url.pathname === "/.well-known/oauth-protected-resource/mcp/v1") {
            return Response.json({
              resource: `${url.origin}/mcp/v1`,
              authorization_servers: [url.origin],
              bearer_methods_supported: ["header"],
              scopes_supported: ["drive.readonly"],
            })
          }

          if (options.metadata && url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              ...(options.registration ? { registration_endpoint: `${url.origin}/register` } : {}),
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
            })
          }

          if (options.registration && url.pathname === "/register") {
            const metadata = await request.json()
            return Response.json({ ...(metadata as object), client_id: "test-client" }, { status: 201 })
          }

          if (url.pathname === "/authorize") {
            const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
            redirect.searchParams.set("code", "test-code")
            const state = url.searchParams.get("state")
            if (state) redirect.searchParams.set("state", state)
            return Response.redirect(redirect, 302)
          }

          if (url.pathname === "/token") {
            return Response.json({ access_token: "test-access-token", token_type: "Bearer", scope: "drive.readonly" })
          }

          return new Response("Not found", { status: 404 })
        },
      })

      return {
        requests,
        url: new URL("/mcp/v1", http.url).toString(),
        close: () => http.stop(true),
      }
    }),
    (server) => Effect.promise(server.close),
  )

const withCallbackStop = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

const trackBrowserOpen = (url: string) =>
  Effect.gen(function* () {
    const origin = new URL(url).origin
    const opened = yield* Deferred.make<string>()
    browsers.set(origin, opened)
    yield* Effect.addFinalizer(() => Effect.sync(() => browsers.delete(origin)))
    return opened
  })

const addServer = Effect.fnUntraced(function* (name: string, url: string) {
  const mcp = yield* MCP.Service
  const result = yield* mcp.add(name, { type: "remote", url })
  // The anonymous connection succeeds, which is exactly why OAuth was never started before.
  expect(result.status).toMatchObject({ [name]: { status: "connected" } })
  return mcp
})

mcpTest.instance("authenticate starts OAuth when an anonymous server advertises protected-resource metadata", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveAnonymousMcp({ metadata: true, registration: true })
    const opened = yield* trackBrowserOpen(server.url)
    const mcp = yield* addServer("advertised-oauth", server.url)

    const authorization = yield* Deferred.make<string>()
    const status = yield* awaitWithTimeout(
      mcp.authenticate("advertised-oauth", (url) => Deferred.doneUnsafe(authorization, Effect.succeed(url))),
      "Timed out completing OAuth authentication",
      "5 seconds",
    )
    const url = yield* Deferred.await(opened)

    expect(status).toEqual({ status: "connected" })
    expect(yield* Deferred.await(authorization)).toBe(url)
    expect(new URL(url).pathname).toBe("/authorize")
    expect(new URL(url).searchParams.get("client_id")).toBe("test-client")
    expect(yield* mcp.hasStoredTokens("advertised-oauth")).toBe(true)
    expect(yield* mcp.getAuthStatus("advertised-oauth")).toBe("authenticated")
    // The reconnect after the exchange presents the new token to the MCP endpoint.
    expect(
      server.requests.some(
        (request) => request.pathname === "/mcp/v1" && request.authorization === "Bearer test-access-token",
      ),
    ).toBe(true)
  }),
)

mcpTest.instance("authenticate keeps the anonymous connection when the server advertises no OAuth", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveAnonymousMcp({ metadata: false, registration: false })
    const opened = yield* trackBrowserOpen(server.url)
    const mcp = yield* addServer("anonymous-mcp", server.url)

    const status = yield* awaitWithTimeout(
      mcp.authenticate("anonymous-mcp"),
      "Timed out authenticating anonymous server",
      "5 seconds",
    )
    const browser = yield* Deferred.await(opened).pipe(Effect.timeoutOption("300 millis"))

    expect(status).toEqual({ status: "connected" })
    expect(browser).toEqual(Option.none())
    expect(yield* mcp.hasStoredTokens("anonymous-mcp")).toBe(false)
  }),
)

mcpTest.instance("authenticate reports needs_client_registration instead of success without a client ID", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveAnonymousMcp({ metadata: true, registration: false })
    const opened = yield* trackBrowserOpen(server.url)
    const mcp = yield* addServer("advertised-no-dcr", server.url)

    const status = yield* awaitWithTimeout(
      mcp.authenticate("advertised-no-dcr"),
      "Timed out authenticating server without registration",
      "5 seconds",
    )
    const browser = yield* Deferred.await(opened).pipe(Effect.timeoutOption("300 millis"))

    expect(status.status).toBe("needs_client_registration")
    expect(browser).toEqual(Option.none())
    expect(yield* mcp.hasStoredTokens("advertised-no-dcr")).toBe(false)
  }),
)
