import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { Config } from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { McpAuth } from "../../../src/mcp/auth"
import { MCP } from "../../../src/mcp/index"
import { refreshExpired } from "../../../src/kilocode/mcp/refresh"
import { testEffect } from "../../lib/effect"

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

// A server that rejects an expired access token with `403` (rather than `401`), like Anaconda's
// MCP endpoint. The MCP SDK only retries a request as an authentication failure on `401`, so an
// expired-but-refreshable token is otherwise reported as `needs_auth` forever.
function serveExpiringOAuthMcp() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const protocol = new Server({ name: "expiring-oauth", version: "1.0.0" }, { capabilities: { tools: {} } })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({ tools: [{ name: "test_tool", inputSchema: { type: "object" } }] }),
      )
      await protocol.connect(transport)

      const expired = "expired-token"
      const fresh = "fresh-token"
      let refreshes = 0

      const http = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin

          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
            })
          }
          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            if (body.get("grant_type") !== "refresh_token" || body.get("refresh_token") !== "rotated-refresh") {
              return Response.json({ error: "invalid_grant" }, { status: 400 })
            }
            refreshes++
            return Response.json({
              access_token: fresh,
              refresh_token: "rotated-refresh",
              token_type: "Bearer",
              expires_in: 300,
            })
          }
          if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })

          const auth = request.headers.get("authorization")
          if (request.method === "GET") {
            if (auth !== `Bearer ${fresh}`) return new Response(null, { status: auth ? 403 : 401 })
            return new Response(null, { status: 405 })
          }
          if (auth !== `Bearer ${fresh}`) {
            // An expired token is rejected as forbidden, not unauthorized.
            return Response.json(
              { error: { code: "auth_invalid", message: "Unable to authorize request" } },
              { status: 403 },
            )
          }
          return transport.handleRequest(request)
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        refreshes: () => refreshes,
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

const remote = (url: string) => ({ type: "remote" as const, url })

mcpTest.instance("refreshes an expired stored token instead of reporting needs_auth", () =>
  Effect.gen(function* () {
    const server = yield* serveExpiringOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-expired-refresh"

    yield* auth.updateClientInfo(name, { clientId: "test-client" }, server.url)
    yield* auth.updateTokens(
      name,
      {
        accessToken: "expired-token",
        refreshToken: "rotated-refresh",
        expiresAt: 1,
        issuer: new URL(server.url).origin,
      },
      server.url,
    )

    const result = yield* mcp.add(name, remote(server.url))
    expect((result.status as Record<string, { status: string }>)[name]?.status).toBe("connected")
    expect(server.refreshes()).toBe(1)
    expect((yield* auth.getForUrl(name, server.url))?.tokens?.accessToken).toBe("fresh-token")
  }),
)

mcpTest.instance("a stalled refresh settles within its timeout and does not pin the single-flight entry", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const name = "test-refresh-timeout"
    const serverUrl = "https://stalled.example/mcp"

    yield* auth.updateClientInfo(name, { clientId: "test-client" }, serverUrl)
    yield* auth.updateTokens(
      name,
      { accessToken: "expired-token", refreshToken: "refresh-token", expiresAt: 1, issuer: "https://stalled.example" },
      serverUrl,
    )

    // A server that never answers: the refresh must be abandoned at the timeout, not awaited forever.
    let calls = 0
    const hang = () => {
      calls++
      return new Promise<Response>(() => {})
    }
    const args = { name, serverUrl, auth, fetch: hang, timeout: 250 }

    const started = Date.now()
    yield* Effect.promise(() => refreshExpired(args))
    expect(Date.now() - started).toBeLessThan(2000)
    expect(calls).toBe(1)

    // The single-flight entry must have settled and been cleared, so this call starts a fresh
    // attempt (a second fetch) rather than returning the previous one.
    yield* Effect.promise(() => refreshExpired(args))
    expect(calls).toBe(2)
  }),
)
