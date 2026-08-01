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
