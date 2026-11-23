import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Layer } from "effect"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { McpAuth } from "@/mcp/auth"
import { McpBrowser } from "@/mcp/browser"
import { MCP } from "@/mcp/index"
import { testEffect } from "../../lib/effect"

const browser = Layer.mock(McpBrowser.Service, {
  open: () => Effect.die("unexpected browser open"),
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node]), [
    [McpBrowser.node, browser],
  ]),
)

const serve = Effect.acquireRelease(
  Effect.sync(() =>
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("Forbidden", { status: 403 }),
    }),
  ),
  (server) => Effect.promise(() => server.stop(true)),
)

it.instance("classifies remote HTTP authentication failures as needs_auth with the original error", () =>
  Effect.gen(function* () {
    const server = yield* serve
    const mcp = yield* MCP.Service
    const name = "plain-403"

    const result = yield* mcp.add(name, { type: "remote", url: new URL("/mcp", server.url).toString() })
    const status = "status" in result.status ? result.status : result.status[name]

    expect(status?.status).toBe("needs_auth")
    expect(status && "error" in status ? status.error : undefined).toContain("403")
  }),
)

it.instance("leaves OAuth-disabled HTTP authentication failures failed without a pending auth flow", () =>
  Effect.gen(function* () {
    const server = yield* serve
    const mcp = yield* MCP.Service
    const name = "oauth-disabled-403"

    const result = yield* mcp.add(name, {
      type: "remote",
      url: new URL("/mcp", server.url).toString(),
      oauth: false,
    })
    const status = "status" in result.status ? result.status : result.status[name]

    expect(status?.status).toBe("failed")
    expect(status && "error" in status ? status.error : undefined).toContain("403")

    const exit = yield* Effect.exit(mcp.finishAuth(name, "unused-code"))
    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "an auth flow was unexpectedly pending").toContain(
      "No pending OAuth flow",
    )
  }),
)
