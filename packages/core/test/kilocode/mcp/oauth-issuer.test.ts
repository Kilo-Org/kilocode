import { describe, expect, test } from "bun:test"
import { auth } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpClientMetadata } from "@opencode/core/kilocode/mcp/client-metadata"
import { McpOAuthIssuer } from "@opencode/core/kilocode/mcp/oauth-issuer"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect } from "effect"

const integrationID = Integration.ID.make("mcp_issuer")
const methodID = Integration.MethodID.make("oauth")

// Client identity without the CIMD policy: this suite is about the issuer binding, not the document.
const identity = { binding: McpOAuthIssuer.binding }

const memoryCredentials = (initial: Credential.Info[] = []) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  const unused = () => Effect.die("unused credential method")
  const service = Credential.Service.of({
    lock: unused,
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

// An authorization server that records every request it receives.
const server = () => {
  const requests: { path: string; body: string }[] = []
  const http = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = await request.text()
      requests.push({ path: url.pathname, body })
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        })
      if (url.pathname === "/register")
        return Response.json({ ...JSON.parse(body), client_id: `registered-${url.port}` })
      if (url.pathname === "/token")
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: `refresh-${url.port}`,
          expires_in: 3600,
        })
      return new Response(null, { status: 404 })
    },
  })
  return { http, requests, url: http.url.origin }
}

// An MCP server whose protected resource metadata names the current authorization server.
const resource = (issuer: string) => {
  const state = { issuer }
  const http = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [state.issuer] })
      return new Response(null, { status: 404 })
    },
  })
  return { http, state, url: `${http.url.origin}/mcp` }
}

const login = async (input: {
  url: string
  oauth?: ConfigMCP.OAuth
  store: ReturnType<typeof memoryCredentials>
  clientMetadata?: typeof McpClientMetadata.oauth
}) => {
  const { url, redirect, credential } = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const authorization = yield* McpOAuth.authorize({
          name: "test",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: input.url,
            ...(input.oauth ? { oauth: input.oauth } : {}),
          }),
          integrationID,
          methodID,
          clientMetadata: input.clientMetadata ?? identity,
        })
        const url = new URL(authorization.url)
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
        redirect.searchParams.set("code", "code")
        redirect.searchParams.set("state", url.searchParams.get("state") ?? "")
        expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(200)
        const credential = yield* authorization.callback
        return { url, redirect, credential }
      }).pipe(Effect.provideService(Credential.Service, input.store.service)),
    ),
  )
  return { url, redirect, credential }
}

const persist = (store: ReturnType<typeof memoryCredentials>, credential: Credential.OAuth) => {
  const id = Credential.ID.make(`cred_${store.rows.size + 1}`)
  const row = new Credential.Info({ id, integrationID, label: "test", value: credential })
  store.rows.set(id, row)
  return row
}

const connect = (
  url: string,
  oauth: ConfigMCP.OAuth | undefined,
  store: ReturnType<typeof memoryCredentials>,
  clientMetadata: typeof McpClientMetadata.oauth = identity,
) =>
  Effect.runPromise(
    McpOAuth.connectProvider({
      config: new ConfigMCP.Remote({ type: "remote", url, ...(oauth ? { oauth } : {}) }),
      credential: Array.from(store.rows.values()).at(-1),
      clientMetadata,
    }).pipe(Effect.provideService(Credential.Service, store.service)),
  )

const cases: { name: string; oauth?: ConfigMCP.OAuth; secret?: string }[] = [
  { name: "dynamically registered client" },
  {
    name: "configured confidential client",
    oauth: new ConfigMCP.OAuth({ client_id: "static", client_secret: "configured-secret" }),
    secret: "configured-secret",
  },
]

describe("MCP OAuth issuer binding", () => {
  test("keeps the configured binding with its issuer and drops it for a registration", () => {
    const bound = { client_id: "static", issuer: "https://one.example" }
    expect(McpOAuthIssuer.configured(bound, "static", "secret")).toEqual({
      client_id: "static",
      client_secret: "secret",
      issuer: "https://one.example",
    })
    expect(McpOAuthIssuer.configured(undefined, "static", "secret")).toEqual({
      client_id: "static",
      client_secret: "secret",
    })
    expect(
      McpOAuthIssuer.configured(
        { client_id: "registered", client_secret: "registered", issuer: "https://one.example" },
        "static",
        "secret",
      ),
    ).toEqual({ client_id: "registered", client_secret: "registered", issuer: "https://one.example" })
    expect(
      McpOAuthIssuer.configured(
        {
          client_id: "registered",
          client_secret: "registered",
          client_secret_expires_at: 1,
          issuer: "https://one.example",
        },
        "static",
        "secret",
      ),
    ).toBeUndefined()
    // Only the configured client's secret is stripped; a registration keeps what it needs to refresh.
    expect(
      McpOAuthIssuer.stored({ client_id: "static", client_secret: "secret", issuer: "https://one.example" }, "static"),
    ).toEqual({
      client_id: "static",
      issuer: "https://one.example",
    })
    expect(
      McpOAuthIssuer.stored(
        { client_id: "registered", client_secret: "registered", issuer: "https://one.example" },
        "static",
      ),
    ).toEqual({ client_id: "registered", client_secret: "registered", issuer: "https://one.example" })
    // A registration may reuse the configured id; it must never become the configured binding.
    const echoed = {
      client_id: "static",
      client_secret: "server-secret",
      redirect_uris: ["http://127.0.0.1/callback"],
      issuer: "https://two.example",
    }
    expect(McpOAuthIssuer.stored(echoed, "static")).toEqual(echoed)
    expect(McpOAuthIssuer.configured(echoed, "static", "secret")).toEqual(echoed)
  })

  for (const item of cases)
    test(`${item.name}: credentials stay with the authorization server that issued them`, async () => {
      const first = server()
      const second = server()
      const mcp = resource(first.url)
      const store = memoryCredentials()
      try {
        // authorize returns the credential; the integration service is what persists it in production.
        const before = persist(store, (await login({ url: mcp.url, oauth: item.oauth, store })).credential)
        const old = `refresh-${new URL(first.url).port}`
        if (before.value.type !== "oauth") throw new Error("expected an oauth credential")
        expect(before.value.metadata?.issuer).toContain(first.url)
        expect((before.value.metadata?.client as { issuer?: string } | undefined)?.issuer).toContain(first.url)
        expect(JSON.stringify(before.value)).not.toContain("configured-secret")

        // The MCP server now names a different authorization server: the user authorizes again there.
        mcp.state.issuer = second.url
        const again = persist(store, (await login({ url: mcp.url, oauth: item.oauth, store })).credential)
        if (again.value.type !== "oauth") throw new Error("expected an oauth credential")
        const registered = `registered-${new URL(second.url).port}`
        expect(again.value.metadata?.issuer).toContain(second.url)
        expect(again.value.metadata?.client).toMatchObject({ client_id: registered })
        // Exactly one registration at the new server proves the first issuer's client was not reused.
        expect(second.requests.filter((request) => request.path === "/register")).toHaveLength(1)

        // Later sessions refresh against the server that issued the current tokens.
        const provider = await connect(mcp.url, item.oauth, store)
        expect(await auth(provider, { serverUrl: mcp.url })).toBe("AUTHORIZED")

        const tokens = second.requests.filter((request) => request.path === "/token")
        expect(tokens.map((request) => new URLSearchParams(request.body).get("grant_type"))).toEqual([
          "authorization_code",
          "refresh_token",
        ])
        expect(tokens.every((request) => new URLSearchParams(request.body).get("client_id") === registered)).toBe(true)
        expect(second.requests.some((request) => request.body.includes(old))).toBe(false)
        const secret = item.secret
        if (secret) expect(second.requests.some((request) => request.body.includes(secret))).toBe(false)
        expect(first.requests.filter((request) => request.path === "/token")).toHaveLength(1)

        const row = Array.from(store.rows.values()).at(-1)
        if (row?.value.type !== "oauth") throw new Error("expected an oauth credential")
        expect(row.value.metadata?.issuer).toContain(second.url)
        expect(row.value.metadata?.client).toMatchObject({ client_id: registered })
        if (secret) expect(JSON.stringify(row.value)).not.toContain(secret)
      } finally {
        first.http.stop(true)
        second.http.stop(true)
        mcp.http.stop(true)
      }
    })

  test("a silent connect registers at the new issuer without presenting the configured secret", async () => {
    const first = server()
    const second = server()
    const mcp = resource(first.url)
    const oauth = new ConfigMCP.OAuth({ client_id: "static", client_secret: "configured-secret" })
    const store = memoryCredentials()
    try {
      await login({ url: mcp.url, oauth, store })
      persist(store, (await login({ url: mcp.url, oauth, store })).credential)
      mcp.state.issuer = second.url

      const provider = await connect(mcp.url, oauth, store)
      const error = await auth(provider, { serverUrl: mcp.url }).catch((cause: unknown) => cause)
      // The silent provider registers and stores the new client, then needs the user for the redirect.
      expect(String(error)).toContain("requires user authorization")
      expect(second.requests.filter((request) => request.path === "/register")).toHaveLength(1)
      expect(second.requests.some((request) => request.body.includes("configured-secret"))).toBe(false)
      expect(Array.from(store.rows.values()).at(-1)?.value.metadata?.client).toMatchObject({
        client_id: `registered-${new URL(second.url).port}`,
        issuer: second.url,
      })
    } finally {
      first.http.stop(true)
      second.http.stop(true)
      mcp.http.stop(true)
    }
  })

  test("a legacy row carrying the configured secret is downgraded to its binding", async () => {
    const first = server()
    const mcp = resource(first.url)
    const oauth = new ConfigMCP.OAuth({ client_id: "static", client_secret: "configured-secret" })
    const store = memoryCredentials()
    try {
      // An earlier build persisted the configured secret next to the issuer stamp.
      const id = Credential.ID.make("cred_legacy")
      store.rows.set(
        id,
        new Credential.Info({
          id,
          integrationID,
          label: "legacy",
          value: {
            type: "oauth",
            methodID,
            access: "access",
            refresh: "refresh",
            expires: 0,
            metadata: {
              issuer: first.url,
              client: { client_id: "static", client_secret: "configured-secret", issuer: first.url },
            },
          },
        }),
      )

      const result = await login({ url: mcp.url, oauth, store })
      expect(result.credential.metadata?.client).toEqual({ client_id: "static", issuer: first.url })
      expect(JSON.stringify(result.credential)).not.toContain("configured-secret")
    } finally {
      first.http.stop(true)
      mcp.http.stop(true)
    }
  })

  test("a silent registration records the loopback the interactive login will use", async () => {
    const first = server()
    const second = server()
    const mcp = resource(first.url)
    const store = memoryCredentials()
    try {
      persist(store, (await login({ url: mcp.url, store, clientMetadata: McpClientMetadata.oauth })).credential)
      // The MCP server moves to a second authorization server; a silent connect registers there.
      mcp.state.issuer = second.url
      const provider = await connect(mcp.url, undefined, store, McpClientMetadata.oauth)
      await auth(provider, { serverUrl: mcp.url }).catch(() => undefined)

      const registration = second.requests.find((request) => request.path === "/register")
      expect(registration).toBeDefined()
      // The registration must list the same loopback the interactive login requests, not upstream's placeholder.
      expect(JSON.parse(registration?.body ?? "{}").redirect_uris).toEqual([McpClientMetadata.callbackUrl])

      const again = await login({ url: mcp.url, store, clientMetadata: McpClientMetadata.oauth })
      expect(again.url.searchParams.get("client_id")).toBe(`registered-${new URL(second.url).port}`)
      expect(again.url.searchParams.get("redirect_uri")).toBe(McpClientMetadata.callbackUrl)
      expect(second.requests.filter((request) => request.path === "/register")).toHaveLength(1)
    } finally {
      first.http.stop(true)
      second.http.stop(true)
      mcp.http.stop(true)
    }
  })
})
