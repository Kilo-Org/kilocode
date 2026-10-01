import { expect } from "bun:test"
import { auth } from "@modelcontextprotocol/sdk/client/auth.js"
import { OAuthClientMetadataSchema, type OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthPendingProvider, McpOAuthProvider, type McpOAuthConfig } from "../../src/mcp/oauth-provider"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(McpAuth.node))

it.live("hosted client document matches the provider's metadata and client ID", () =>
  Effect.gen(function* () {
    const store = yield* McpAuth.Service
    const provider = new McpOAuthProvider("contract", "https://example.com/mcp", {}, { onRedirect: () => {} }, store)
    const document = yield* Effect.promise(() =>
      Bun.file(new URL("../../../kilo-docs/public/oauth/kilo/client.json", import.meta.url)).json(),
    )
    expect(document).toEqual({ client_id: provider.clientMetadataUrl, ...provider.clientMetadata })
  }),
)

function serve(cimd?: boolean, methods?: string[]) {
  const registrations: OAuthClientMetadata[] = []
  const exchanges: URLSearchParams[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          client_id_metadata_document_supported: cimd,
          token_endpoint_auth_methods_supported: methods,
        })
      }
      if (url.pathname === "/register") {
        const metadata = OAuthClientMetadataSchema.parse(await request.json())
        registrations.push(metadata)
        return Response.json({
          ...metadata,
          client_id: "registered",
          ...(metadata.token_endpoint_auth_method === "client_secret_post"
            ? { client_secret: "registered-secret" }
            : {}),
        })
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(await request.text())
        exchanges.push(params)
        return Response.json({
          access_token: params.get("grant_type") === "refresh_token" ? "refreshed" : "access",
          token_type: "Bearer",
          ...(params.get("grant_type") === "authorization_code" ? { refresh_token: "refresh" } : {}),
          expires_in: 3600,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, registrations, exchanges, url: `${server.url.origin}/mcp` }
}

const cases: { name: string; cimd?: boolean; config: McpOAuthConfig; methods?: string[]; document: boolean }[] = [
  { name: "CIMD with public authentication", cimd: true, methods: ["none"], config: {}, document: true },
  { name: "CIMD with omitted authentication methods", cimd: true, config: {}, document: true },
  { name: "DCR when CIMD is absent", config: {}, document: false },
  { name: "DCR when CIMD is false", cimd: false, config: {}, document: false },
  { name: "static public client", cimd: true, config: { clientId: "static" }, document: false },
  {
    name: "static confidential client",
    cimd: true,
    methods: ["none", "client_secret_post"],
    config: { clientId: "static", clientSecret: "secret" },
    document: false,
  },
  {
    name: "secret without a client ID",
    cimd: true,
    methods: ["client_secret_post"],
    config: { clientSecret: "secret" },
    document: false,
  },
  { name: "custom callback port", cimd: true, config: { callbackPort: 23456 }, document: false },
  {
    name: "custom redirect URI",
    cimd: true,
    config: { redirectUri: "http://127.0.0.1:23457/custom" },
    document: false,
  },
  {
    name: "explicit default redirect overrides custom port",
    cimd: true,
    config: { redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback", callbackPort: 23456 },
    document: true,
  },
]

for (const Provider of [McpOAuthProvider, McpOAuthPendingProvider]) {
  for (const item of cases) {
    it.live(`${Provider.name}: ${item.name}`, () =>
      Effect.gen(function* () {
        const store = yield* McpAuth.Service
        const name = `cimd-${crypto.randomUUID()}`
        yield* Effect.addFinalizer(() => store.remove(name))
        const fixture = yield* Effect.acquireRelease(
          Effect.sync(() => serve(item.cimd, item.methods)),
          (fixture) => Effect.sync(() => fixture.server.stop(true)),
        )
        const redirects: URL[] = []
        const provider = new Provider(
          name,
          fixture.url,
          item.config,
          {
            onRedirect: (url) => {
              redirects.push(url)
            },
          },
          store,
        )
        yield* Effect.promise(async () => {
          expect(provider.clientMetadataUrl !== undefined).toBe(item.document || item.cimd !== true)
          const expected = item.document ? provider.clientMetadataUrl! : (item.config.clientId ?? "registered")
          expect(await auth(provider, { serverUrl: fixture.url })).toBe("REDIRECT")
          expect(redirects).toHaveLength(1)
          const redirect = redirects.at(0)!
          expect(redirect.searchParams.get("client_id")).toBe(expected)
          expect(redirect.searchParams.get("redirect_uri")).toBe(provider.redirectUrl)
          expect(fixture.registrations).toHaveLength(item.document || item.config.clientId ? 0 : 1)
          if (fixture.registrations.length) {
            expect(fixture.registrations.at(0)?.redirect_uris).toEqual([provider.redirectUrl])
          }
          if (provider instanceof McpOAuthPendingProvider) {
            await provider.commit()
            expect(await Effect.runPromise(store.get(name))).toBeUndefined()
          }
          expect(await auth(provider, { serverUrl: fixture.url, authorizationCode: "code" })).toBe("AUTHORIZED")
          const exchange = fixture.exchanges.at(0)!
          expect(exchange.get("client_id")).toBe(expected)
          expect(exchange.get("redirect_uri")).toBe(provider.redirectUrl)
          expect(exchange.get("code")).toBe("code")
          expect(exchange.get("code_verifier")).toBe(await provider.codeVerifier())
          expect(exchange.get("client_secret")).toBe(
            item.config.clientSecret ? (item.config.clientId ? "secret" : "registered-secret") : null,
          )
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchange.get("code_verifier")!))
          expect(redirect.searchParams.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"))
          if (provider instanceof McpOAuthPendingProvider) {
            expect(await Effect.runPromise(store.get(name))).toBeUndefined()
            await provider.commit()
          }
          const entry = await Effect.runPromise(store.getForUrl(name, fixture.url))
          expect(entry?.tokens?.accessToken).toBe("access")
          expect(entry?.clientInfo?.clientId).toBe(item.config.clientId ? undefined : expected)
          const restored = new McpOAuthProvider(
            name,
            fixture.url,
            item.config,
            {
              onRedirect: () => {
                throw new Error("unexpected redirect")
              },
            },
            store,
          )
          expect(await auth(restored, { serverUrl: fixture.url })).toBe("AUTHORIZED")
          expect(fixture.exchanges.at(1)?.get("grant_type")).toBe("refresh_token")
          expect(fixture.exchanges.at(1)?.get("client_id")).toBe(expected)
          expect(fixture.exchanges.at(1)?.get("refresh_token")).toBe("refresh")
          expect((await Effect.runPromise(store.get(name)))?.tokens).toMatchObject({
            accessToken: "refreshed",
            refreshToken: "refresh",
          })
        })
      }),
    )
  }
}

it.live("stored DCR credentials take precedence over CIMD; pending reauthorization commits only on success", () =>
  Effect.gen(function* () {
    const store = yield* McpAuth.Service
    const name = `cimd-${crypto.randomUUID()}`
    yield* Effect.addFinalizer(() => store.remove(name))
    const fixture = yield* Effect.acquireRelease(
      Effect.sync(() => serve(true)),
      (fixture) => Effect.sync(() => fixture.server.stop(true)),
    )
    const previous = {
      clientInfo: { clientId: "previous" },
      tokens: { accessToken: "old", refreshToken: "old-refresh" },
    }
    yield* store.set(name, previous, fixture.url)
    yield* Effect.promise(async () => {
      const provider = new McpOAuthProvider(name, fixture.url, {}, { onRedirect: () => {} }, store)
      expect(await auth(provider, { serverUrl: fixture.url })).toBe("AUTHORIZED")
      expect(fixture.exchanges.at(0)?.get("client_id")).toBe("previous")
      expect(fixture.registrations).toHaveLength(0)
      const before = await Effect.runPromise(store.get(name))
      const pending = new McpOAuthPendingProvider(name, fixture.url, {}, { onRedirect: () => {} }, store)
      expect(await auth(pending, { serverUrl: fixture.url })).toBe("REDIRECT")
      await pending.commit()
      expect(await Effect.runPromise(store.get(name))).toEqual(before)
      expect(await auth(pending, { serverUrl: fixture.url, authorizationCode: "code" })).toBe("AUTHORIZED")
      expect(await Effect.runPromise(store.get(name))).toEqual(before)
      await pending.commit()
      expect((await Effect.runPromise(store.get(name)))?.clientInfo?.clientId).toBe(pending.clientMetadataUrl)
    })
  }),
)
