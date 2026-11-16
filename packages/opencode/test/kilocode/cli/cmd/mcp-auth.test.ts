import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { KilocodeMcpAuth } from "@/kilocode/cli/cmd/mcp-auth"
import type { MCP } from "@/mcp"
import { testEffect } from "../../../lib/effect"

const it = testEffect(Layer.empty)

const connected: MCP.Status = { status: "connected" }

const run = Effect.fn("test.run")(function* (status: MCP.Status, stored: MCP.AuthStatus) {
  const calls: string[] = []
  let lookups = 0
  yield* KilocodeMcpAuth.report({
    status,
    serverUrl: "https://example.com/mcp",
    mcp: {
      getAuthStatus: () => {
        lookups++
        return Effect.succeed(stored)
      },
    },
    serverName: "google_drive",
    spinner: { stop: (message, code) => calls.push(`stop:${message}:${code ?? 0}`) },
    prompts: {
      log: {
        error: (m) => calls.push(`error:${m}`),
        warn: (m) => calls.push(`warn:${m}`),
        info: (m) => calls.push(`info:${m}`),
      },
    },
  })
  return { calls, lookups }
})

describe("KilocodeMcpAuth.report", () => {
  it.effect("reports success when credentials are stored", () =>
    Effect.gen(function* () {
      expect((yield* run(connected, "authenticated")).calls).toStrictEqual(["stop:Authentication successful!:0"])
    }),
  )

  const failures = [
    { stored: "not_authenticated", level: "error", text: "no credentials were stored" },
    {
      stored: "expired",
      level: "warn",
      text: "Run `kilo mcp logout google_drive` to remove them. Running `kilo mcp auth google_drive` again only helps if the server issues an OAuth challenge.",
    },
  ] as const
  for (const item of failures) {
    it.effect(`does not report success when connected with stored status ${item.stored}`, () =>
      Effect.gen(function* () {
        const { calls } = yield* run(connected, item.stored)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toBe("stop:Authentication not confirmed:1")
        expect(calls[1]).toStartWith(`${item.level}:MCP server google_drive connected`)
        expect(calls[1]).toContain(item.text)
        expect(calls.join("\n")).not.toContain("Authentication successful!")
      }),
    )
  }

  it.effect("reports needs_client_registration with the config hint and the server url", () =>
    Effect.gen(function* () {
      const result = yield* run({ status: "needs_client_registration", error: "no client id" }, "not_authenticated")
      expect(result.lookups).toBe(0)
      expect(result.calls).toStrictEqual([
        "stop:Authentication failed:1",
        "error:no client id",
        "info:Add clientId to your MCP server config:",
        `info:
  "mcp": {
    "google_drive": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`,
      ])
    }),
  )

  it.effect("reports failed with the error and exit code 1", () =>
    Effect.gen(function* () {
      expect(yield* run({ status: "failed", error: "boom" }, "not_authenticated")).toStrictEqual({
        calls: ["stop:Authentication failed:1", "error:boom"],
        lookups: 0,
      })
    }),
  )

  const unexpected: MCP.Status[] = [{ status: "needs_auth", error: "x" }, { status: "disabled" }]
  for (const status of unexpected) {
    it.effect(`reports ${status.status} as an unexpected status`, () =>
      Effect.gen(function* () {
        expect(yield* run(status, "not_authenticated")).toStrictEqual({
          calls: [`stop:Unexpected status: ${status.status}:1`],
          lookups: 0,
        })
      }),
    )
  }
})
