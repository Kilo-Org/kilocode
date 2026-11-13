import { expect, test } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { authFailure } from "@opencode/core/kilocode/mcp/auth-failure"
import { KiloMcpRefresh } from "@opencode/core/kilocode/mcp/refresh"
import { McpClient } from "@opencode/core/mcp/client"
import type { McpHost } from "@opencode/core/mcp/host"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Cause, Effect, Exit } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"
import { echoMcpHandler } from "../../fixture/mcp-echo"

// A port nothing listens on yet: the token endpoint is unreachable, as during a DNS or VPN outage.
const reservePort = () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = server.port
  server.stop(true)
  if (port === undefined) throw new Error("no port reserved")
  return port
}

// An OAuth-protected MCP server whose access token expired: it answers 401 until it sees the refreshed token.
const protectedServer = (tokenPort: number, tokenEndpoint = `http://127.0.0.1:${tokenPort}/token`) => {
  const mcp = echoMcpHandler()
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] })
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server"))
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: tokenEndpoint,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        })
      if (request.headers.get("authorization") === "Bearer fresh") return mcp.fetch(request)
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
        },
      })
    },
  })
}

const connect = (url: string, host?: McpHost.Host) => {
  const config = new ConfigMCP.Remote({ type: "remote", url, oauth: { client_id: "client" }, codemode: false })
  const rows = new Map([
    [
      Credential.ID.make("cred_test"),
      new Credential.Info({
        id: Credential.ID.make("cred_test"),
        integrationID: Integration.ID.make("mcp_test"),
        label: "test",
        value: {
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "expired",
          refresh: "refresh",
          expires: Date.now() - 1000,
          metadata: { serverUrl: url, tokenType: "Bearer" },
        },
      }),
    ],
  ])
  const unused = () => Effect.die("unused credential method")
  const credentials = Credential.Service.of({
    // The stored-row rules of Credential.refresh, without the cross-process lock.
    refresh: (id, input) =>
      Effect.gen(function* () {
        const current = rows.get(id)
        if (current?.value.type !== "oauth") return undefined
        if (!input.stale(current.value, Date.now())) return current.value
        const value = yield* input.refresh(current.value)
        rows.set(id, new Credential.Info({ ...current, value }))
        return value
      }),
    all: unused,
    create: unused,
    activate: unused,
    list: () => Effect.sync(() => Array.from(rows.values())),
    get: (id) => Effect.sync(() => rows.get(id)),
    update: (id, updates) =>
      Effect.sync(() => {
        const row = rows.get(id)
        if (row) rows.set(id, new Credential.Info({ ...row, ...updates }))
      }),
    remove: (id) => Effect.sync(() => void rows.delete(id)),
  })
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const authProvider = yield* McpOAuth.connectProvider({
          config,
          credential: rows.get(Credential.ID.make("cred_test")),
        })
        yield* McpClient.connect({ server: "axiom", config, directory: import.meta.dir, authProvider, host })
      }),
    ).pipe(Effect.provideService(Credential.Service, credentials), Effect.provide(hostEnvironmentLayer), Effect.exit),
  ).then((exit) => ({ exit, rows }))
}

const host: McpHost.Host = {
  fetch: (base) => KiloMcpRefresh.transient(base),
  authFailure,
  transient: KiloMcpRefresh.isTransient,
}

test("an unreachable token endpoint fails the connect without asking to sign in again", async () => {
  const server = protectedServer(reservePort())
  try {
    // Without the host the transport reports the outage itself and keeps the credential.
    const upstream = await connect(new URL("/mcp", server.url).href)
    expect(Exit.isFailure(upstream.exit) && Cause.squash(upstream.exit.cause)).toBeInstanceOf(McpClient.ConnectError)

    const kilo = await connect(new URL("/mcp", server.url).href, host)
    const error = Exit.isFailure(kilo.exit) ? Cause.squash(kilo.exit.cause) : undefined
    expect(error).toBeInstanceOf(McpClient.ConnectError)
    // The status the connection reports follows the same host classification.
    expect(authFailure((error as Error).message)).toBe(false)
    // The pool records a server that answered and then refused the shared handshake; an outage is not that.
    expect((error as McpClient.ConnectError).answered).not.toBe(true)
    expect((error as Error).message).toContain("temporarily_unavailable")
    // The cause the transport saw, not the status of its own answer.
    expect((error as Error).message).not.toContain("HTTP 503")
    const stored = kilo.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.refresh).toBe("refresh")
  } finally {
    server.stop(true)
  }
})

test("refreshes and connects once the token endpoint is reachable again", async () => {
  const port = reservePort()
  const server = protectedServer(port)
  const token = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: () =>
      Response.json({ access_token: "fresh", token_type: "Bearer", refresh_token: "next", expires_in: 3600 }),
  })
  try {
    const kilo = await connect(new URL("/mcp", server.url).href, host)
    expect(Exit.isSuccess(kilo.exit)).toBe(true)
    const stored = kilo.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.access).toBe("fresh")
  } finally {
    token.stop(true)
    server.stop(true)
  }
})

test("passes a rejected refresh through so a revoked credential still asks to sign in", async () => {
  const port = reservePort()
  const server = protectedServer(port)
  const token = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
  })
  try {
    const kilo = await connect(new URL("/mcp", server.url).href, host)
    expect(Exit.isFailure(kilo.exit) && Cause.squash(kilo.exit.cause)).toBeInstanceOf(McpClient.NeedsAuthError)
  } finally {
    token.stop(true)
    server.stop(true)
  }
})

test("a refresh failure whose host looks like an authorization endpoint is not a sign-in request", async () => {
  const wrapped = KiloMcpRefresh.transient(() =>
    Promise.reject(new TypeError("ECONNREFUSED: Unable to connect. Is the computer able to access the url?")),
  )
  const error = await wrapped("http://oauth.example.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token" }),
  }).catch((error: unknown) => error)

  expect((error as Error).message).toContain("oauth.example.com")
  expect(KiloMcpRefresh.isTransient(error)).toBe(true)
  expect(authFailure((error as Error).message)).toBe(false)
})

test("a 408 from the token server asks to sign in without the host and is retryable with it", async () => {
  const port = reservePort()
  const server = protectedServer(port)
  const token = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response(null, { status: 408 }) })
  try {
    const upstream = await connect(new URL("/mcp", server.url).href)
    expect(Exit.isFailure(upstream.exit) && Cause.squash(upstream.exit.cause)).toBeInstanceOf(McpClient.NeedsAuthError)
    const kilo = await connect(new URL("/mcp", server.url).href, host)
    expect(Exit.isFailure(kilo.exit) && Cause.squash(kilo.exit.cause)).toBeInstanceOf(McpClient.ConnectError)
  } finally {
    token.stop(true)
    server.stop(true)
  }
})

test("treats a refresh the token server cannot serve yet as retryable", async () => {
  for (const status of [408, 429, 500, 503]) {
    const port = reservePort()
    const server = protectedServer(port)
    const token = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response(null, { status }) })
    try {
      const kilo = await connect(new URL("/mcp", server.url).href, host)
      const error = Exit.isFailure(kilo.exit) ? Cause.squash(kilo.exit.cause) : undefined
      expect(`${(error as Error)?.constructor?.name} ${(error as Error)?.message}`).toContain(`HTTP ${status}`)
      expect(error).toBeInstanceOf(McpClient.ConnectError)
      expect((error as Error).message).toContain("temporarily_unavailable")
      expect(authFailure((error as Error).message)).toBe(false)
    } finally {
      token.stop(true)
      server.stop(true)
    }
  }
}, 20_000)

test("does not treat a rejected refresh as retryable", async () => {
  const port = reservePort()
  const server = protectedServer(port)
  const token = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
  })
  try {
    const kilo = await connect(new URL("/mcp", server.url).href, host)
    const error = Exit.isFailure(kilo.exit) ? Cause.squash(kilo.exit.cause) : undefined
    expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
    expect((error as Error).message).not.toContain("temporarily_unavailable")
  } finally {
    token.stop(true)
    server.stop(true)
  }
})

test("the transient predicate matches the refresh code and nothing else", () => {
  expect(KiloMcpRefresh.isTransient({ code: "temporarily_unavailable" })).toBe(true)
  expect(KiloMcpRefresh.isTransient(new Error("Token refresh at h failed with HTTP 503"))).toBe(false)
  expect(KiloMcpRefresh.isTransient({ code: "invalid_grant" })).toBe(false)
  expect(KiloMcpRefresh.isTransient(undefined)).toBe(false)
})
