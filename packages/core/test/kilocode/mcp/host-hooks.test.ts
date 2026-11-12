import { expect, test } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { KiloSseProbe } from "@opencode/core/kilocode/mcp/sse-probe"
import { McpClient } from "@opencode/core/mcp/client"
import type { McpHost } from "@opencode/core/mcp/host"
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

test("uses the host OAuth client identity and keeps the upstream default", async () => {
  const unused = () => Effect.die("unused credential method")
  const credentials = Credential.Service.of({
    lock: unused,
    all: unused,
    create: unused,
    activate: unused,
    list: unused,
    get: unused,
    update: unused,
    remove: unused,
  })
  const config = new ConfigMCP.Remote({ type: "remote", url: "https://example.com/mcp" })
  // An anonymous connect-time provider reads no credential, so it only needs the service to exist.
  const identity = (clientMetadata?: McpHost.OAuth) =>
    Effect.runPromise(
      McpOAuth.connectProvider({ config, credential: undefined, clientMetadata }).pipe(
        Effect.provideService(Credential.Service, credentials),
      ),
    ).then((provider) => provider.clientMetadata)

  const branded = await identity({ name: "Kilo", uri: "https://kilo.ai" })
  expect(branded?.client_name).toBe("Kilo")
  expect(branded?.client_uri).toBe("https://kilo.ai")

  const upstream = await identity()
  expect(upstream?.client_name).toBe("opencode")
  expect(upstream?.client_uri).toBe("https://opencode.ai")
})
