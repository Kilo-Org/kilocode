import { expect } from "bun:test"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { McpAuthMode } from "../../src/kilocode/mcp/auth-mode"
import { testEffect } from "../lib/effect"

const it = testEffect(MCP.defaultLayer)

it.instance(
  "does not classify static Authorization headers as OAuth",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service

      expect(yield* mcp.supportsOAuth("header")).toBe(false)
      expect(yield* mcp.supportsOAuth("oauth")).toBe(true)
      expect(yield* mcp.supportsOAuth("custom")).toBe(true)
      expect(yield* mcp.supportsOAuth("disabled")).toBe(false)
    }),
  {
    config: {
      mcp: {
        header: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: false,
          headers: { authorization: "Bearer token" },
        },
        oauth: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: false,
          headers: { Authorization: "Bearer bootstrap-token" },
          oauth: {},
        },
        custom: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: false,
          headers: { "X-Organization": "example" },
        },
        disabled: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: false,
          oauth: false,
        },
      },
    },
  },
)

it.effect("describes how to fix rejected header credentials", () =>
  Effect.sync(() => {
    const message = McpAuthMode.failure("example")

    expect(message).toContain("configured Authorization header")
    expect(message).toContain("environment variables")
    expect(message).not.toContain("mcp auth")
  }),
)

it.instance(
  "reports a real 401 for a static Authorization header without retrying over SSE",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      let requests = 0
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch() {
          requests++
          return new Response("Unauthorized", { status: 401 })
        },
      })

      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))

      const result = yield* mcp.add("header", {
        type: "remote",
        url: `http://127.0.0.1:${server.port}/mcp`,
        headers: { Authorization: "Bearer rejected" },
      })
      const status = "header" in result.status ? result.status.header : result.status

      expect(status).toEqual({
        status: "failed",
        error:
          'Server "header" rejected the configured Authorization header. Check its value and any referenced environment variables.',
      })
      expect(requests).toBe(1)
    }),
  { config: { mcp: {} } },
)
