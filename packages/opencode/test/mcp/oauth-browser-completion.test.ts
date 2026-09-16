// kilocode_change - new file
import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Cause, Effect, Fiber } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpAuth } from "../../src/mcp/auth"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { testEffect, pollWithTimeout } from "../lib/effect"

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

const OTHER_STATE = "state-written-by-another-kilo-process"
const OTHER_VERIFIER = "verifier-written-by-another-kilo-process"

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString("base64url")
}

function serveOAuthMcp() {
  const seen = { challenge: undefined as string | undefined }
  const server = Effect.acquireRelease(
    Effect.promise(async () => {
      const protocol = new Server(
        { name: "oauth-browser", version: "1.0.0" },
        { capabilities: { tools: {} } },
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({ tools: [{ name: "test_tool", inputSchema: { type: "object" } }] }),
      )

      await protocol.connect(transport)
      const http = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          const mcpUrl = `${origin}/mcp`

          if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
            return Response.json({ resource: mcpUrl, authorization_servers: [origin], scopes_supported: ["mcp"] })
          }
          if (url.pathname === "/.well-known/oauth-protected-resource") {
            return Response.json({ resource: mcpUrl, authorization_servers: [origin], scopes_supported: ["mcp"] })
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/register") {
            const metadata = (await request.json()) as Record<string, unknown>
            return Response.json({ ...metadata, client_id: "browser-client" }, { status: 201 })
          }
          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            const verifier = body.get("code_verifier") ?? ""
            if (seen.challenge && (await challenge(verifier)) !== seen.challenge) {
              return Response.json(
                { error: "invalid_grant", error_description: "PKCE verification failed" },
                { status: 400 },
              )
            }
            if (body.get("code") !== "browser-code") {
              return Response.json(
                { error: "invalid_grant", error_description: "Authorization code is invalid" },
                { status: 400 },
              )
            }
            return Response.json({ access_token: "browser-token", token_type: "Bearer" })
          }
          if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })

          if (request.method === "GET") return new Response(null, { status: 405 })
          if (request.headers.get("authorization") !== "Bearer browser-token") {
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`,
              },
            })
          }
          return transport.handleRequest(request)
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (s) => Effect.promise(s.close),
  )
  return { seen, server }
}

const stopOAuthCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

function waitForAuthorizationUrl(get: () => string) {
  return pollWithTimeout(
    Effect.sync(() => {
      const url = get()
      if (!url) return undefined
      expect(url).toContain("/authorize")
      return url
    }),
    "the CLI never produced an authorization URL",
  )
}

function parseAuthorization(url: string) {
  const authorize = new URL(url)
  const state = authorize.searchParams.get("state")
  const redirect = authorize.searchParams.get("redirect_uri")
  expect(state).toBeTruthy()
  expect(redirect).toBe("http://127.0.0.1:19876/mcp/oauth/callback")
  return { state: state!, redirect: redirect!, challenge: authorize.searchParams.get("code_challenge") }
}

function deliverCallback(url: string, query: string) {
  return Effect.gen(function* () {
    const authorize = parseAuthorization(url)
    const response = yield* Effect.promise(() => fetch(`${authorize.redirect}?${query}`))
    expect(response.status).toBe(200)
    return authorize
  })
}

function startFlow(name: string, url: string) {
  return Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp.add(name, { type: "remote", url })
    let captured = ""
    const fiber = yield* mcp
      .authenticate(name, (authUrl) => {
        captured = authUrl
      })
      .pipe(Effect.forkChild)
    const authorizationUrl = yield* waitForAuthorizationUrl(() => captured)
    return { mcp, fiber, authorizationUrl }
  })
}

mcpTest.instance("authenticate() completes when the callback is completed in a separate browser tab", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const { seen, server } = serveOAuthMcp()
    const target = yield* server
    const flow = yield* startFlow("test-browser-completion", target.url)
    const authorize = yield* deliverCallback(flow.authorizationUrl, "code=browser-code&state=" + parseAuthorization(flow.authorizationUrl).state)
    seen.challenge = authorize.challenge ?? undefined

    const status = yield* Fiber.join(flow.fiber)
    expect(status.status).toBe("connected")
    expect((yield* flow.mcp.status())["test-browser-completion"]?.status).toBe("connected")
  }),
)

mcpTest.instance("authenticate() redeems with its own PKCE verifier when another Kilo process rewrites the shared auth file", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const { seen, server } = serveOAuthMcp()
    const target = yield* server
    const flow = yield* startFlow("test-shared-verifier", target.url)
    const authorize = parseAuthorization(flow.authorizationUrl)
    seen.challenge = authorize.challenge ?? undefined

    // While the browser tab is open, any other Kilo process sharing mcp-auth.json
    // (the VS Code extension, a TUI in another terminal) that touches this server
    // rewrites its OAuth credentials.
    const auth = yield* McpAuth.Service
    yield* auth.updateCodeVerifier("test-shared-verifier", OTHER_VERIFIER)

    yield* deliverCallback(flow.authorizationUrl, `code=browser-code&state=${authorize.state}`)

    const status = yield* Fiber.join(flow.fiber)
    expect(status.status).toBe("connected")
    expect((yield* flow.mcp.status())["test-shared-verifier"]?.status).toBe("connected")
  }),
)

mcpTest.instance("authenticate() matches the callback against its own state when another Kilo process rewrites the shared auth file", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const { server } = serveOAuthMcp()
    const target = yield* server
    const flow = yield* startFlow("test-shared-state", target.url)
    const authorize = parseAuthorization(flow.authorizationUrl)

    const auth = yield* McpAuth.Service
    yield* auth.updateOAuthState("test-shared-state", OTHER_STATE)

    yield* deliverCallback(flow.authorizationUrl, `code=browser-code&state=${authorize.state}`)

    const status = yield* Fiber.join(flow.fiber)
    expect(status.status).toBe("connected")
    expect((yield* flow.mcp.status())["test-shared-state"]?.status).toBe("connected")
  }),
)

mcpTest.instance("authenticate() names the token exchange when the authorization server rejects the code", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const { server } = serveOAuthMcp()
    const target = yield* server
    const flow = yield* startFlow("test-token-exchange", target.url)
    const authorize = parseAuthorization(flow.authorizationUrl)

    yield* deliverCallback(flow.authorizationUrl, `code=stale-code&state=${authorize.state}`)

    const status = yield* Fiber.join(flow.fiber)
    if (status.status !== "failed") throw new Error(`expected a failed status, received ${status.status}`)
    expect(status.error).toContain("Token exchange")
    expect(status.error).toContain("Authorization code is invalid")
  }),
)

mcpTest.instance("authenticate() names the browser step when the authorization screen reports an error", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const { server } = serveOAuthMcp()
    const target = yield* server
    const flow = yield* startFlow("test-callback-error", target.url)
    const authorize = parseAuthorization(flow.authorizationUrl)

    yield* deliverCallback(
      flow.authorizationUrl,
      `error=access_denied&error_description=Authorization%20approval%20was%20not%20confirmed&state=${authorize.state}`,
    )

    const outcome = yield* Fiber.join(flow.fiber).pipe(
      Effect.map(() => undefined),
      Effect.catchCause((cause) => Effect.succeed(Cause.squash(cause))),
    )
    expect(outcome).toBeInstanceOf(Error)
    if (!(outcome instanceof Error)) throw new Error(`expected an Error, received ${String(outcome)}`)
    expect(outcome.message).toContain("Browser authorization failed")
    expect(outcome.message).toContain("Authorization approval was not confirmed")
  }),
)
