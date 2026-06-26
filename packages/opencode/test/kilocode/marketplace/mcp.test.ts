import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { decodeManifest, resolveMcp } from "@/kilocode/marketplace"
import { testEffect } from "../../lib/effect"
import { localManifest, manifest } from "./fixture"

const it = testEffect(Layer.empty)

describe("Marketplace MCP resolution", () => {
  it.effect("substitutes only non-sensitive parameters and remains disabled", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeManifest(manifest())
      const item = decoded.items[0]
      if (item.kind !== "mcp") return yield* Effect.die("expected MCP fixture")
      const config = yield* resolveMcp({
        item,
        method: "remote-http",
        parameters: { workspace: "analytics" },
      })
      expect(config).toEqual({
        type: "remote",
        url: "https://mcp.example.com/analytics",
        headers: { Authorization: "Bearer {env:MCP_TOKEN}" },
        enabled: false,
      })
    }),
  )

  it.effect("renders local commands and environment references without enabling the server", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeManifest(localManifest())
      const item = decoded.items[0]
      if (item.kind !== "mcp") return yield* Effect.die("expected MCP fixture")
      const config = yield* resolveMcp({
        item,
        method: "local-npx",
        parameters: { workspace: "analytics" },
      })
      if (config.type !== "local") return yield* Effect.die("expected local MCP config")
      expect(Array.from(config.command)).toEqual(["npx", "-y", "example-mcp", "--workspace", "analytics"])
      expect(Object.fromEntries(Object.entries(config.environment ?? {}))).toEqual({ MCP_TOKEN: "{env:MCP_TOKEN}" })
      expect(config.enabled).toBe(false)
    }),
  )

  it.effect("rejects sensitive values supplied by a caller", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeManifest(manifest())
      const item = decoded.items[0]
      if (item.kind !== "mcp") return yield* Effect.die("expected MCP fixture")
      const error = yield* Effect.flip(
        resolveMcp({
          item,
          method: "remote-http",
          parameters: { workspace: "analytics", token: "do-not-store" },
        }),
      )
      expect(error.reason).toBe("sensitive_parameter")
      expect(error.parameter).toBe("token")
    }),
  )

  it.effect("rejects missing, unknown, and placeholder-shaped parameter values", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeManifest(manifest())
      const item = decoded.items[0]
      if (item.kind !== "mcp") return yield* Effect.die("expected MCP fixture")

      const missing = yield* Effect.flip(resolveMcp({ item, method: "remote-http" }))
      expect(missing.reason).toBe("missing_parameter")

      const unknown = yield* Effect.flip(
        resolveMcp({ item, method: "remote-http", parameters: { workspace: "analytics", extra: "value" } }),
      )
      expect(unknown.reason).toBe("unknown_parameter")

      const unsafe = yield* Effect.flip(
        resolveMcp({ item, method: "remote-http", parameters: { workspace: "{env:STOLEN}" } }),
      )
      expect(unsafe.reason).toBe("invalid_parameter")
    }),
  )
})
