import { expect, test } from "bun:test"
import path from "node:path"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { McpClient } from "@opencode/core/mcp/client"
import type { McpHost } from "@opencode/core/mcp/host"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect, Exit } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"

const fixture = path.join(import.meta.dir, "fixture.ts")

test("applies the host localCommand hook before spawning a local server", async () => {
  const tools = await Effect.runPromise(
    Effect.scoped(
      McpClient.connect({
        server: "hooks",
        config: { type: "local", command: [process.execPath, fixture] },
        directory: import.meta.dir,
        host: {
          localCommand: ({ command, args }) => ({ command, args: [...args, "--host-hook"] }),
        },
      }).pipe(
        Effect.flatMap((connection) => connection.tools()),
        Effect.provide(hostEnvironmentLayer),
      ),
    ),
  )

  expect(tools.map((tool) => tool.name)).toContain("echo")
})

test("wraps the remote transport fetch with the host hook", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Unauthorized", { status: 401 }),
  })
  try {
    let calls = 0
    const exit = await Effect.runPromise(
      Effect.scoped(
        McpClient.connect({
          server: "remote",
          config: { type: "remote", url: new URL("/mcp", server.url).toString(), oauth: false },
          directory: import.meta.dir,
          host: {
            fetch: (base) => (input, init) => {
              calls += 1
              return base(input, init)
            },
          },
        }).pipe(Effect.provide(hostEnvironmentLayer)),
      ).pipe(Effect.timeout("5 seconds"), Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toBeGreaterThan(0)
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
