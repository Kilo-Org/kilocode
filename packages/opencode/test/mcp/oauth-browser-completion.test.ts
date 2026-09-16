// kilocode_change - new file
import { expect } from "bun:test"
import { createServer } from "http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as KiloOAuthCallback from "../../src/kilocode/mcp-oauth-callback"
import { McpAuth } from "../../src/mcp/auth"
import { McpBrowser } from "../../src/mcp/browser"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { awaitWithTimeout, testEffect } from "../lib/effect"

async function freePort() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const address = probe.address()
  if (!address || typeof address === "string") throw new Error("missing probe address")
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return address.port
}

async function s256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Buffer.from(digest).toString("base64url")
}

interface TokenAttempt {
  code: string | null
  verifier: string
  matched: boolean
}

// The browser stub drives the authorization URL the same way a real browser does:
// it follows the authorization server's redirect back to the local callback listener.
// `onOpen` lets a test act while the browser tab is open, which is when another Kilo
// process touches the same server.
let onOpen: ((url: string) => Effect.Effect<void>) | undefined

const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) =>
      Effect.gen(function* () {
        const hook = onOpen
        if (hook) yield* hook(url)
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

function serveOAuthMcp() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const challenges = new Map<string, string>()
      const attempts: TokenAttempt[] = []
      let denyConsent = false

      const protocol = new Server(
        { name: "oauth-browser-completion", version: "1.0.0" },
        { capabilities: { tools: {} } },
      )
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
            if (request.headers.get("authorization") === "Bearer test-access-token")
              return transport.handleRequest(request)
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
              },
            })
          }

          if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
            return Response.json({
              resource: `${origin}/mcp`,
              authorization_servers: [origin],
              scopes_supported: ["mcp"],
            })
          }

          if (url.pathname === "/.well-known/oauth-authorization-server") {
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
          }

          if (url.pathname === "/register") {
            const metadata = await request.json()
            if (!metadata || typeof metadata !== "object") return new Response("Invalid metadata", { status: 400 })
            return Response.json({ ...metadata, client_id: "test-client" }, { status: 201 })
          }

          if (url.pathname === "/authorize") {
            const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
            const state = url.searchParams.get("state")
            if (state) redirect.searchParams.set("state", state)
            if (denyConsent) {
              redirect.searchParams.set("error", "access_denied")
              redirect.searchParams.set("error_description", "User denied the request")
              return Response.redirect(redirect, 302)
            }
            const code = `code-${challenges.size + 1}-${crypto.randomUUID()}`
            challenges.set(code, url.searchParams.get("code_challenge") ?? "")
            redirect.searchParams.set("code", code)
            return Response.redirect(redirect, 302)
          }

          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            const code = body.get("code")
            const verifier = body.get("code_verifier") ?? ""
            const challenge = code ? challenges.get(code) : undefined
            if (!challenge) {
              attempts.push({ code, verifier, matched: false })
              return Response.json({ error: "invalid_grant" }, { status: 400 })
            }
            const matched = (await s256(verifier)) === challenge
            attempts.push({ code, verifier, matched })
            if (!matched) {
              return Response.json(
                { error: "invalid_grant", error_description: "PKCE verification failed" },
                { status: 400 },
              )
            }
            return Response.json({ access_token: "test-access-token", token_type: "Bearer", scope: "mcp" })
          }

          return new Response("Not found", { status: 404 })
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        attempts: () => attempts,
        denyConsent: () => {
          denyConsent = true
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

const withCallbackStop = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

const withBrowserHook = (hook: (url: string) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    onOpen = hook
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        onOpen = undefined
      }),
    )
  })

const addServer = Effect.fnUntraced(function* (name: string, url: string) {
  const mcp = yield* MCP.Service
  const result = yield* mcp.add(name, { type: "remote", url })
  expect(result.status).toMatchObject({ [name]: { status: "needs_auth" } })
  return mcp
})

mcpTest.instance("completion redeems the flow's own PKCE verifier when another process rewrites the shared entry", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp()
    const auth = yield* McpAuth.Service
    const name = "test-oauth-clobber"
    const mcp = yield* addServer(name, server.url)

    // While the browser tab is open, another Kilo process (the VS Code backend, or
    // `kilo mcp list` in a second terminal) connects the same server and saves its own
    // PKCE verifier for that server name, exactly as the SDK does while starting an
    // authorization flow. It must not be able to make this flow redeem its verifier.
    let clobbered: string | undefined
    yield* withBrowserHook(() =>
      Effect.promise(async () => {
        const other = new McpOAuthProvider(name, server.url, {}, { onRedirect: async () => {} }, auth)
        await other.saveCodeVerifier("verifier-from-another-kilo-process")
        clobbered = (await Effect.runPromise(auth.get(name)))?.codeVerifier
      }),
    )

    const status = yield* awaitWithTimeout(
      mcp.authenticate(name),
      "Timed out completing OAuth authentication",
      "10 seconds",
    )

    expect(status).toEqual({ status: "connected" })
    expect(clobbered).toBe("verifier-from-another-kilo-process")
    expect(server.attempts()).toHaveLength(1)
    expect(server.attempts()[0]).toMatchObject({ matched: true })
    expect(server.attempts()[0]?.verifier).not.toBe("verifier-from-another-kilo-process")
  }),
)

mcpTest.instance("token exchange failure names the step and the OAuth error code", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp()
    const name = "test-oauth-token-error"
    const mcp = yield* addServer(name, server.url)
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")

    const status = yield* mcp.finishAuth(name, "unknown-authorization-code")

    expect(status).toEqual({ status: "failed", error: "Token exchange failed: invalid_grant" })
  }),
)

mcpTest.instance("an error callback fails the browser step by name", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp()
    server.denyConsent()
    const name = "test-oauth-callback-error"
    const mcp = yield* addServer(name, server.url)

    const status = yield* awaitWithTimeout(
      mcp.authenticate(name),
      "Timed out completing OAuth authentication",
      "10 seconds",
    )

    expect(status).toEqual({ status: "failed", error: "Browser authorization failed: User denied the request" })
  }),
)

mcpTest.instance("a superseded authorization attempt is rejected by name", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp()
    const name = "test-oauth-superseded"
    const mcp = yield* addServer(name, server.url)

    const gate = yield* Deferred.make<void>()
    let seen = 0
    yield* withBrowserHook(() =>
      Effect.gen(function* () {
        seen++
        if (seen === 2) Deferred.doneUnsafe(gate, Effect.void)
        yield* Deferred.await(gate)
      }),
    )

    const results = yield* awaitWithTimeout(
      Effect.all([mcp.authenticate(name), mcp.authenticate(name)], { concurrency: 2 }),
      "Timed out running two concurrent authorization attempts",
      "10 seconds",
    )

    expect(results.map((result) => result.status).sort()).toEqual(["connected", "failed"])
    expect(results.find((result) => result.status === "failed")).toEqual({
      status: "failed",
      error: "Browser authorization was rejected: this request was replaced by another authorization attempt",
    })
  }),
)

mcpTest.instance("a callback listener taken over by another Kilo process is reported as replaced", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp()
    const name = "test-oauth-takeover"
    const mcp = yield* MCP.Service
    const port = yield* Effect.promise(freePort)
    const path = "/mcp/oauth/callback"
    const redirectUri = `http://127.0.0.1:${port}${path}`
    const added = yield* mcp.add(name, { type: "remote", url: server.url, oauth: { redirectUri } })
    expect(added.status).toMatchObject({ [name]: { status: "needs_auth" } })

    // While this process waits for its browser tab, a second `kilo mcp auth` for the same
    // server takes the callback listener over: no callback can reach this flow any more.
    let taken = false
    yield* withBrowserHook(() =>
      Effect.promise(async () => {
        const res = await fetch(KiloOAuthCallback.takeoverUrl("127.0.0.1", port, path), {
          headers: { [KiloOAuthCallback.TAKEOVER_HEADER]: KiloOAuthCallback.TAKEOVER_VALUE },
        })
        taken = res.ok
        await res.body?.cancel()
      }),
    )

    const status = yield* awaitWithTimeout(
      mcp.authenticate(name),
      "Timed out completing the taken-over authorization",
      "10 seconds",
    )

    expect(taken).toBe(true)
    expect(status).toEqual({
      status: "failed",
      error: "Browser authorization was rejected: this request was replaced by another authorization attempt",
    })
  }),
)
