import { describe, expect, test } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpClientMetadata } from "@opencode/core/kilocode/mcp/client-metadata"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect } from "effect"

const integrationID = Integration.ID.make("mcp_cimd")
const methodID = Integration.MethodID.make("oauth")

const memoryCredentials = () => {
  const rows = new Map<string, Credential.Info>()
  const unused = () => Effect.die("unused credential method")
  const service = Credential.Service.of({
    refresh: unused,
    all: unused,
    create: unused,
    activate: unused,
    list: (id) => Effect.sync(() => Array.from(rows.values()).filter((row) => row.integrationID === id)),
    get: (id) => Effect.sync(() => rows.get(id)),
    update: (id, updates) =>
      Effect.sync(() => {
        const row = rows.get(id)
        if (row) rows.set(id, new Credential.Info({ ...row, ...updates }))
      }),
    remove: (id) => Effect.sync(() => void rows.delete(id)),
  })
  return { rows, service }
}

// Serves authorization server metadata with the given capabilities and records registration and token requests.
const authorizationServer = (metadata: Record<string, unknown>) => {
  const registrations: Record<string, unknown>[] = []
  const tokenRequests: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          ...metadata,
        })
      if (request.method === "POST" && url.pathname === "/register") {
        const body = (await request.json()) as Record<string, unknown>
        registrations.push(body)
        return Response.json({ ...body, client_id: "registered" })
      }
      if (request.method === "POST" && url.pathname === "/token") {
        const params = new URLSearchParams(await request.text())
        tokenRequests.push(params)
        return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 3600 })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, registrations, tokenRequests }
}

const start = (target: string | ReturnType<typeof Bun.serve>, oauth?: ConfigMCP.OAuth, store = memoryCredentials()) =>
  Effect.gen(function* () {
    const authorization = yield* McpOAuth.authorize({
      name: "test",
      config: new ConfigMCP.Remote({
        type: "remote",
        url: typeof target === "string" ? target : target.url.href,
        ...(oauth ? { oauth } : {}),
      }),
      integrationID,
      methodID,
      clientMetadata: McpClientMetadata.oauth,
    })
    const url = new URL(authorization.url)
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
    redirect.searchParams.set("code", "accepted")
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "")
    const response = yield* Effect.promise(() => fetch(redirect))
    const credential = yield* authorization.callback
    return { url, redirect, status: response.status, credential }
  }).pipe(Effect.provideService(Credential.Service, store.service))

const cases: { name: string; config: ConfigMCP.OAuth | undefined; document: boolean; callback?: [number, string] }[] = [
  {
    name: "CIMD with public authentication",
    config: undefined,
    document: true,
    callback: [19876, "/mcp/oauth/callback"],
  },
  {
    name: "static public client",
    config: new ConfigMCP.OAuth({ client_id: "static" }),
    document: false,
    callback: undefined,
  },
  {
    name: "static confidential client",
    config: new ConfigMCP.OAuth({ client_id: "static", client_secret: "secret" }),
    document: false,
    callback: undefined,
  },
  {
    name: "secret without a client ID",
    config: new ConfigMCP.OAuth({ client_secret: "secret" }),
    document: false,
    callback: undefined,
  },
  {
    name: "custom callback port",
    config: new ConfigMCP.OAuth({ callback_port: 23456 }),
    document: false,
    callback: undefined,
  },
  {
    name: "callback port on the document loopback",
    config: new ConfigMCP.OAuth({ callback_port: 19876 }),
    document: false,
    callback: undefined,
  },
  {
    name: "custom redirect URI",
    config: new ConfigMCP.OAuth({ redirect_uri: "http://127.0.0.1:23457/custom" }),
    document: false,
    callback: [23457, "/custom"],
  },
  {
    name: "explicit default redirect overrides custom port",
    config: new ConfigMCP.OAuth({ redirect_uri: McpClientMetadata.callbackUrl, callback_port: 23456 }),
    document: true,
    callback: [19876, "/mcp/oauth/callback"],
  },
]

describe("MCP client ID metadata document", () => {
  for (const item of cases)
    test(`${item.name}: document and loopback`, () => {
      expect(McpClientMetadata.document(item.config)).toBe(
        item.document ? McpClientMetadata.clientMetadataUrl : undefined,
      )
      expect(McpClientMetadata.callback(item.config)).toEqual(
        item.callback ? { port: item.callback[0], path: item.callback[1] } : undefined,
      )
    })

  test("presents the hosted document on a server that supports CIMD", async () => {
    const { server, registrations, tokenRequests } = authorizationServer({
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    })
    const result = await Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))

    expect(result.status).toBe(200)
    expect(result.url.searchParams.get("client_id")).toBe(McpClientMetadata.clientMetadataUrl)
    expect(result.url.searchParams.get("redirect_uri")).toBe(McpClientMetadata.callbackUrl)
    expect(registrations).toHaveLength(0)
    expect(tokenRequests[0]?.get("client_id")).toBe(McpClientMetadata.clientMetadataUrl)
    expect(tokenRequests[0]?.get("client_secret")).toBeNull()
    expect(result.credential.metadata?.client).toEqual({
      client_id: McpClientMetadata.clientMetadataUrl,
      issuer: server.url.origin,
    })
  })

  test("registers when the server does not advertise CIMD", async () => {
    const { server, registrations } = authorizationServer({ token_endpoint_auth_methods_supported: ["none"] })
    const result = await Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))

    expect(result.status).toBe(200)
    expect(result.url.searchParams.get("client_id")).toBe("registered")
    // The document's loopback is still the callback the client registers, so the redirect stays valid.
    expect(result.url.searchParams.get("redirect_uri")).toBe(McpClientMetadata.callbackUrl)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.redirect_uris).toEqual([McpClientMetadata.callbackUrl])
  })

  test("keeps a configured client out of the document and never stores its secret", async () => {
    const { server, registrations, tokenRequests } = authorizationServer({
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    })
    const result = await Effect.runPromise(
      Effect.scoped(start(server, new ConfigMCP.OAuth({ client_id: "static", client_secret: "secret" }))),
    ).finally(() => server.stop(true))

    expect(result.status).toBe(200)
    expect(result.url.searchParams.get("client_id")).toBe("static")
    // Without the hosted document the login keeps upstream's ephemeral loopback instead of contending for 19876.
    expect(result.url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(result.url.searchParams.get("redirect_uri")).not.toBe(McpClientMetadata.callbackUrl)
    expect(registrations).toHaveLength(0)
    expect(tokenRequests[0]?.get("client_id")).toBe("static")
    expect(tokenRequests[0]?.get("client_secret")).toBe("secret")
    expect(result.credential.metadata?.client).toEqual({ client_id: "static", issuer: server.url.origin })
    expect(JSON.stringify(result.credential)).not.toContain("secret")
  })

  test("keeps a custom callback port on the upstream path and registers", async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
    const port = probe.port
    probe.stop(true)
    const { server, registrations } = authorizationServer({
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    })
    const result = await Effect.runPromise(
      Effect.scoped(start(server, new ConfigMCP.OAuth({ callback_port: port ?? 0 }))),
    ).finally(() => server.stop(true))

    expect(result.status).toBe(200)
    expect(result.url.searchParams.get("client_id")).toBe("registered")
    expect(result.redirect.origin).toBe(`http://127.0.0.1:${port}`)
    expect(result.redirect.pathname).toBe("/callback")
    expect(registrations).toHaveLength(1)
    // DCR must record the loopback the listener bound, not upstream's placeholder.
    expect(registrations[0]?.redirect_uris).toEqual([result.redirect.origin + result.redirect.pathname])
  })

  test("lets an explicit document redirect own the listener even with a custom port", async () => {
    const { server, registrations } = authorizationServer({
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    })
    const result = await Effect.runPromise(
      Effect.scoped(
        start(server, new ConfigMCP.OAuth({ redirect_uri: McpClientMetadata.callbackUrl, callback_port: 23456 })),
      ),
    ).finally(() => server.stop(true))

    // The browser flow only completes if the listener bound the redirect's port, not callback_port.
    expect(result.status).toBe(200)
    expect(result.url.searchParams.get("client_id")).toBe(McpClientMetadata.clientMetadataUrl)
    expect(result.redirect.origin + result.redirect.pathname).toBe(McpClientMetadata.callbackUrl)
    expect(registrations).toHaveLength(0)
  })
})
