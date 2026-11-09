import { expect, test } from "bun:test"
import path from "node:path"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect, Exit } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"

const fixture = path.join(import.meta.dir, "fixture.ts")

test("applies the host localCommand hook before spawning a local server", async () => {
  const tools = await Effect.runPromise(
    Effect.scoped(
      McpClient.connect(
        "hooks",
        { type: "local", command: [process.execPath, fixture] },
        import.meta.dir,
        undefined,
        undefined,
        undefined,
        {
          localCommand: ({ command, args }) => ({ command, args: [...args, "--host-hook"] }),
        },
      ).pipe(
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
        McpClient.connect(
          "remote",
          { type: "remote", url: new URL("/mcp", server.url).toString(), oauth: false },
          import.meta.dir,
          undefined,
          undefined,
          undefined,
          {
            fetch: (base) => (input, init) => {
              calls += 1
              return base(input, init)
            },
          },
        ).pipe(Effect.provide(hostEnvironmentLayer)),
      ).pipe(Effect.timeout("5 seconds"), Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toBeGreaterThan(0)
  } finally {
    server.stop(true)
  }
})

test("uses the host OAuth client identity and keeps the upstream default", () => {
  const config = new ConfigMCP.Remote({ type: "remote", url: "https://example.com/mcp" })
  const branded = McpOAuth.provider({
    config,
    store: McpOAuth.memoryStore(),
    clientMetadata: { name: "Kilo", uri: "https://kilo.ai" },
  })
  expect(branded.clientMetadata?.client_name).toBe("Kilo")
  expect(branded.clientMetadata?.client_uri).toBe("https://kilo.ai")

  const upstream = McpOAuth.provider({ config, store: McpOAuth.memoryStore() })
  expect(upstream.clientMetadata?.client_name).toBe("opencode")
  expect(upstream.clientMetadata?.client_uri).toBe("https://opencode.ai")
})
