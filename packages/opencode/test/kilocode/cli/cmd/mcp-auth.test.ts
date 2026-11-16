import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { KilocodeMcpAuth } from "@/kilocode/cli/cmd/mcp-auth"
import type { MCP } from "@/mcp"
import { testEffect } from "../../../lib/effect"

const it = testEffect(Layer.empty)

const run = Effect.fn("test.run")(function* (status: MCP.Status["status"], stored: MCP.AuthStatus) {
  const calls: string[] = []
  let lookups = 0
  yield* KilocodeMcpAuth.report({
    status: { status },
    mcp: {
      getAuthStatus: () => {
        lookups++
        return Effect.succeed(stored)
      },
    },
    serverName: "google_drive",
    spinner: { stop: (message, code) => calls.push(`stop:${message}:${code ?? 0}`) },
    prompts: { log: { error: (m) => calls.push(`error:${m}`), warn: (m) => calls.push(`warn:${m}`) } },
  })
  return { calls, lookups }
})

describe("KilocodeMcpAuth.report", () => {
  it.effect("reports success when credentials are stored", () =>
    Effect.gen(function* () {
      expect((yield* run("connected", "authenticated")).calls).toStrictEqual(["stop:Authentication successful!:0"])
    }),
  )

  const failures = [
    { stored: "not_authenticated", level: "error", text: "no credentials were stored" },
    { stored: "expired", level: "warn", text: "kilo mcp logout google_drive" },
  ] as const
  for (const item of failures) {
    it.effect(`does not report success when connected with stored status ${item.stored}`, () =>
      Effect.gen(function* () {
        const { calls } = yield* run("connected", item.stored)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toBe("stop:Authentication not confirmed:1")
        expect(calls[1]).toStartWith(`${item.level}:MCP server google_drive connected`)
        expect(calls[1]).toContain(item.text)
        expect(calls.join("\n")).not.toContain("Authentication successful!")
      }),
    )
  }

  const others: MCP.Status["status"][] = ["needs_auth", "needs_client_registration", "failed", "disabled"]
  for (const status of others) {
    it.effect(`leaves ${status} to the caller without output or lookups`, () =>
      Effect.gen(function* () {
        expect(yield* run(status, "not_authenticated")).toStrictEqual({ calls: [], lookups: 0 })
      }),
    )
  }
})
