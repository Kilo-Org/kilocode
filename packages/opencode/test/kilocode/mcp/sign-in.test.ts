import { expect } from "bun:test"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Config } from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { McpAuth } from "../../../src/mcp/auth"
import { McpBrowser } from "../../../src/mcp/browser"
import { MCP } from "../../../src/mcp/index"
import { McpOAuthCallback } from "../../../src/mcp/oauth-callback"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

// The browser stub follows the authorization server's redirect back to the local callback
// listener, the same way a real browser does after the user approves.
const opened: string[] = []
const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) =>
      Effect.tryPromise({
        try: () => {
          opened.push(url)
          return fetch(url).then((response) => response.body?.cancel())
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)

const it = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node]), [
    [McpBrowser.node, browserLayer],
  ]),
)

const TOKEN = "sign-in-access-token"

/**
 * - `tools`: authorization is enforced only for `tools/call`, as Socket's remote MCP server does:
 *   `initialize` and `tools/list` succeed without credentials.
 * - `all`: every MCP request is challenged (Atlassian, Miro).
 * - `none`: the server needs no authorization and advertises no OAuth metadata.
 */
type Protect = "tools" | "all" | "none"

function serve(protect: Protect) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const seen = { authorize: [] as URLSearchParams[], register: 0, token: 0 }
      const challenges = new Map<string, string>()

      // Stateless: every request gets its own protocol instance, so several clients can
      // initialize against the same endpoint (the background connection and a sign-in).
      const handle = async (request: Request) => {
        const protocol = new Server({ name: "sign-in", version: "1.0.0" }, { capabilities: { tools: {} } })
        protocol.setRequestHandler(ListToolsRequestSchema, () =>
          Promise.resolve({ tools: [{ name: "organizations", inputSchema: { type: "object" as const } }] }),
        )
        protocol.setRequestHandler(CallToolRequestSchema, () =>
          Promise.resolve({ content: [{ type: "text" as const, text: "acme" }] }),
        )
        const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
        await protocol.connect(transport)
        return transport.handleRequest(request)
      }

      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`

          if (url.pathname === "/mcp") {
            const authorized = request.headers.get("authorization") === `Bearer ${TOKEN}`
            const body = request.method === "POST" ? await request.clone().json() : undefined
            const method = body && typeof body === "object" && "method" in body ? body.method : undefined
            const guarded = protect === "all" || (protect === "tools" && method === "tools/call")
            if (guarded && !authorized)
              return new Response(JSON.stringify({ error: "invalid_request" }), {
                status: 401,
                headers: { "WWW-Authenticate": `Bearer error="invalid_request", resource_metadata="${metadata}"` },
              })
            return handle(request)
          }

          if (protect === "none") return new Response("Not found", { status: 404 })

          if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
            return Response.json({
              resource: `${origin}/mcp`,
              authorization_servers: [origin],
              scopes_supported: ["packages:list", "alerts:list"],
              bearer_methods_supported: ["header"],
            })

          if (url.pathname === "/.well-known/oauth-authorization-server")
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
            })

          if (url.pathname === "/register") {
            seen.register++
            const body: unknown = await request.json()
            if (!body || typeof body !== "object") return new Response("Invalid metadata", { status: 400 })
            return Response.json({ ...body, client_id: "sign-in-client" }, { status: 201 })
          }

          if (url.pathname === "/authorize") {
            seen.authorize.push(url.searchParams)
            const code = crypto.randomUUID()
            challenges.set(code, url.searchParams.get("code_challenge") ?? "")
            const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
            redirect.searchParams.set("code", code)
            redirect.searchParams.set("state", url.searchParams.get("state") ?? "")
            return Response.redirect(redirect, 302)
          }

          if (url.pathname === "/token") {
            seen.token++
            const body = new URLSearchParams(await request.text())
            const challenge = challenges.get(body.get("code") ?? "")
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(body.get("code_verifier") ?? ""),
            )
            if (!challenge || Buffer.from(digest).toString("base64url") !== challenge)
              return Response.json({ error: "invalid_grant" }, { status: 400 })
            return Response.json({ access_token: TOKEN, token_type: "Bearer", expires_in: 3600 })
          }

          return new Response("Not found", { status: 404 })
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        seen,
        close: () => http.stop(true),
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

const setup = Effect.fnUntraced(function* (name: string, protect: Protect, scope?: string) {
  opened.length = 0
  yield* Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))
  const server = yield* serve(protect)
  const mcp = yield* MCP.Service
  const added = yield* mcp.add(name, { type: "remote", url: server.url, ...(scope ? { oauth: { scope } } : {}) })
  return { server, mcp, added: added.status }
})

const call = Effect.fnUntraced(function* (mcp: MCP.Interface, name: string) {
  const tool = (yield* mcp.tools())[`${name}_organizations`]
  if (!tool) return yield* Effect.die(new Error(`missing tool for ${name}`))
  return yield* Effect.tryPromise({
    try: () => tool.client.callTool({ name: "organizations", arguments: {} }),
    catch: (error) => error,
  })
})

it.instance("a server that only protects tool calls connects unauthenticated and rejects the tool call", () =>
  Effect.gen(function* () {
    const name = "socket-like-runtime"
    const ctx = yield* setup(name, "tools")

    expect(ctx.added).toMatchObject({ [name]: { status: "connected" } })
    const failure = yield* Effect.flip(call(ctx.mcp, name))
    expect(failure).toBeInstanceOf(UnauthorizedError)
    expect(yield* ctx.mcp.getAuthStatus(name)).toBe("not_authenticated")
    // A background connection never opens a browser on its own.
    expect(opened).toHaveLength(0)
  }),
)

it.instance("explicit sign-in runs OAuth when the connection itself was not challenged", () =>
  Effect.gen(function* () {
    const name = "socket-like-sign-in"
    const ctx = yield* setup(name, "tools")

    const status = yield* awaitWithTimeout(ctx.mcp.authenticate(name), "Timed out signing in", "10 seconds")

    expect(status).toEqual({ status: "connected" })
    expect(opened).toHaveLength(1)
    expect(ctx.server.seen.register).toBe(1)
    expect(ctx.server.seen.token).toBe(1)
    // Scope and resource indicator come from the advertised protected resource metadata.
    const params = ctx.server.seen.authorize.at(0)
    expect(params?.get("scope")).toBe("packages:list alerts:list")
    expect(params?.get("resource")).toBe(ctx.server.url)
    expect(params?.get("code_challenge_method")).toBe("S256")
    expect(yield* ctx.mcp.getAuthStatus(name)).toBe("authenticated")
    expect(yield* call(ctx.mcp, name)).toMatchObject({ content: [{ type: "text", text: "acme" }] })
  }),
)

it.instance("explicit sign-in requests the configured scope instead of the advertised scopes", () =>
  Effect.gen(function* () {
    const name = "socket-like-scope"
    const ctx = yield* setup(name, "tools", "packages:list")

    const status = yield* awaitWithTimeout(ctx.mcp.authenticate(name), "Timed out signing in", "10 seconds")

    expect(status).toEqual({ status: "connected" })
    expect(ctx.server.seen.authorize.at(0)?.get("scope")).toBe("packages:list")
  }),
)

it.instance("explicit sign-in fails when the server offers no way to obtain credentials", () =>
  Effect.gen(function* () {
    const name = "no-oauth"
    const ctx = yield* setup(name, "none")
    expect(ctx.added).toMatchObject({ [name]: { status: "connected" } })

    const status = yield* ctx.mcp.authenticate(name)

    expect(status.status).toBe("failed")
    expect(status.status === "failed" ? status.error : "").toStartWith(
      `MCP server "${name}" could not start OAuth sign-in:`,
    )
    expect(opened).toHaveLength(0)
    expect(yield* ctx.mcp.getAuthStatus(name)).toBe("not_authenticated")
    expect(yield* ctx.mcp.hasStoredTokens(name)).toBe(false)
    // The existing working connection is left alone.
    expect((yield* ctx.mcp.status())[name]).toEqual({ status: "connected" })
  }),
)

it.instance("explicit sign-in against a server that challenges every request completes normally", () =>
  Effect.gen(function* () {
    const name = "challenged-sign-in"
    const ctx = yield* setup(name, "all")
    expect(ctx.added).toMatchObject({ [name]: { status: "needs_auth" } })

    const status = yield* awaitWithTimeout(ctx.mcp.authenticate(name), "Timed out signing in", "10 seconds")

    expect(status).toEqual({ status: "connected" })
    expect(opened).toHaveLength(1)
    expect(ctx.server.seen.token).toBe(1)
    expect(yield* ctx.mcp.getAuthStatus(name)).toBe("authenticated")
    expect(yield* call(ctx.mcp, name)).toMatchObject({ content: [{ type: "text", text: "acme" }] })
  }),
)
