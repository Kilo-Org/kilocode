import { expect, test } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { McpClientMetadata } from "@opencode/core/kilocode/mcp/client-metadata"
import { KiloSseProbe } from "@opencode/core/kilocode/mcp/sse-probe"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect, Exit } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"
import { echoMcpHandler } from "../../fixture/mcp-echo"

test("wraps the remote transport fetch with the host hook", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Unauthorized", { status: 401 }),
  })
  try {
    const endpoints: string[] = []
    const exit = await Effect.runPromise(
      Effect.scoped(
        McpClient.connect({
          server: "remote",
          config: { type: "remote", url: new URL("/mcp", server.url).toString(), oauth: false },
          directory: import.meta.dir,
          host: {
            fetch: (base, endpoint) => {
              endpoints.push(endpoint)
              return (input, init) => base(input, init)
            },
          },
        }).pipe(Effect.provide(hostEnvironmentLayer)),
      ).pipe(Effect.timeout("5 seconds"), Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(endpoints).toEqual([new URL("/mcp", server.url).toString()])
  } finally {
    server.stop(true)
  }
})

test("normalizes a non-SSE stream probe for a real server", async () => {
  const mcp = echoMcpHandler()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      request.method === "GET"
        ? new Response("<html>not an event stream</html>", { headers: { "content-type": "text/html" } })
        : mcp.fetch(request),
  })
  const endpoint = new URL("/mcp", server.url).toString()
  try {
    const endpoints: string[] = []
    const exit = await Effect.runPromise(
      Effect.scoped(
        McpClient.connect({
          server: "probe",
          config: { type: "remote", url: endpoint, oauth: false, codemode: false },
          directory: import.meta.dir,
          host: {
            fetch: (base, dialed) => {
              endpoints.push(dialed)
              return KiloSseProbe.probe(base, dialed)
            },
          },
        }).pipe(Effect.provide(hostEnvironmentLayer)),
      ).pipe(Effect.timeout("5 seconds"), Effect.exit),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(endpoints).toEqual([endpoint])
  } finally {
    server.stop(true)
  }
})

test("keeps the host OAuth client identity for the login and leaves the connect provider anonymous", async () => {
  const unused = () => Effect.die("unused credential method")
  const credentials = Credential.Service.of({
    refresh: unused,
    all: unused,
    create: unused,
    activate: unused,
    list: unused,
    get: unused,
    update: unused,
    remove: unused,
  })
  const config = new ConfigMCP.Remote({ type: "remote", url: "https://example.com/mcp" })
  // Upstream moved client registration into the login, so an anonymous connect only reports no token. The host
  // identity reaches the provider that registers during `authorize`, covered by the CIMD tests.
  const provider = await Effect.runPromise(
    McpOAuth.connectProvider({ server: "example", config, credential: undefined }).pipe(
      Effect.provideService(Credential.Service, credentials),
    ),
  )
  expect(await provider.token()).toBeUndefined()
  expect(McpClientMetadata.oauth.name).toBe("Kilo")
  expect(McpClientMetadata.oauth.uri).toBe("https://kilo.ai")
})
