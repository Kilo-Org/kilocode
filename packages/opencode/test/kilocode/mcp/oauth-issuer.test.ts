import { expect } from "bun:test"
import { auth } from "@modelcontextprotocol/sdk/client/auth.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { McpAuth } from "../../../src/mcp/auth"
import { McpOAuthPendingProvider, McpOAuthProvider, type McpOAuthConfig } from "../../../src/mcp/oauth-provider"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(McpAuth.node))

// An authorization server that records every request it receives.
function server() {
  const requests: { path: string; body: string }[] = []
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = await request.text()
      requests.push({ path: url.pathname, body })
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        })
      }
      if (url.pathname === "/register") {
        return Response.json({ ...JSON.parse(body), client_id: "registered" })
      }
      if (url.pathname === "/token") {
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: `refresh-${url.port}`,
          expires_in: 3600,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { http, requests, url: http.url.origin }
}

// An MCP server whose protected resource metadata names the current authorization server.
function resource(issuer: string) {
  const state = { issuer }
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [state.issuer] })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { http, state, url: `${http.url.origin}/mcp` }
}

const cases: { name: string; config: McpOAuthConfig; secret?: string }[] = [
  { name: "dynamically registered client", config: {} },
  {
    name: "configured confidential client",
    config: { clientId: "static", clientSecret: "configured-secret" },
    secret: "configured-secret",
  },
]

for (const Provider of [McpOAuthProvider, McpOAuthPendingProvider]) {
  for (const item of cases) {
    it.live(`${Provider.name}: ${item.name} credentials stay with the authorization server that issued them`, () =>
      Effect.gen(function* () {
        const store = yield* McpAuth.Service
        const name = `issuer-${crypto.randomUUID()}`
        yield* Effect.addFinalizer(() => store.remove(name))
        const first = yield* Effect.acquireRelease(Effect.sync(server), (s) => Effect.sync(() => s.http.stop(true)))
        const second = yield* Effect.acquireRelease(Effect.sync(server), (s) => Effect.sync(() => s.http.stop(true)))
        const mcp = yield* Effect.acquireRelease(
          Effect.sync(() => resource(first.url)),
          (s) => Effect.sync(() => s.http.stop(true)),
        )
        yield* Effect.promise(async () => {
          const provider = new Provider(name, mcp.url, item.config, { onRedirect: () => {} }, store)
          expect(await auth(provider, { serverUrl: mcp.url })).toBe("REDIRECT")
          expect(await auth(provider, { serverUrl: mcp.url, authorizationCode: "code" })).toBe("AUTHORIZED")
          if (provider instanceof McpOAuthPendingProvider) await provider.commit()
          const old = `refresh-${new URL(first.url).port}`
          const before = await Effect.runPromise(store.getForUrl(name, mcp.url))
          expect(before?.tokens?.refreshToken).toBe(old)
          expect(before?.tokens?.issuer).toContain(first.url)
          expect(before?.clientInfo?.issuer).toContain(first.url)
          expect(before?.clientInfo?.clientSecret).toBeUndefined()

          // The MCP server now names a different authorization server: the user
          // authorizes again there, and later sessions refresh against it.
          mcp.state.issuer = second.url
          const redirects: URL[] = []
          const again = new Provider(
            name,
            mcp.url,
            item.config,
            {
              onRedirect: (url) => {
                redirects.push(url)
              },
            },
            store,
          )
          expect(await auth(again, { serverUrl: mcp.url })).toBe("REDIRECT")
          expect(redirects.at(0)?.origin).toBe(second.url)
          expect(await auth(again, { serverUrl: mcp.url, authorizationCode: "code" })).toBe("AUTHORIZED")
          if (again instanceof McpOAuthPendingProvider) await again.commit()
          const later = new McpOAuthProvider(name, mcp.url, item.config, { onRedirect: () => {} }, store)
          expect(await auth(later, { serverUrl: mcp.url })).toBe("AUTHORIZED")

          const tokens = second.requests.filter((request) => request.path === "/token")
          expect(tokens.map((request) => new URLSearchParams(request.body).get("grant_type"))).toEqual([
            "authorization_code",
            "refresh_token",
          ])
          expect(tokens.every((request) => new URLSearchParams(request.body).get("client_id") === "registered")).toBe(
            true,
          )
          expect(second.requests.some((request) => request.body.includes(old))).toBe(false)
          if (item.secret) expect(second.requests.some((request) => request.body.includes(item.secret!))).toBe(false)
          expect(first.requests.filter((request) => request.path === "/token")).toHaveLength(1)
          const after = await Effect.runPromise(store.getForUrl(name, mcp.url))
          expect(after?.tokens?.issuer).toContain(second.url)
          expect(after?.clientInfo).toMatchObject({ clientId: "registered" })
          expect(after?.clientInfo?.issuer).toContain(second.url)
          if (item.secret) expect(JSON.stringify(after)).not.toContain(item.secret)
        })
      }),
    )
  }
}
