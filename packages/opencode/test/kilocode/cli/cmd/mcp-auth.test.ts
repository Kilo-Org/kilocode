import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { KilocodeMcpAuth } from "@/kilocode/cli/cmd/mcp-auth"
import type { MCP } from "@/mcp"
import { testEffect } from "../../../lib/effect"

const it = testEffect(Layer.empty)

const run = Effect.fn("test.run")(function* (stored: MCP.AuthStatus) {
  const calls: string[] = []
  yield* KilocodeMcpAuth.connected({
    mcp: {
      getAuthStatus: () => {
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
  return { calls }
})

describe("KilocodeMcpAuth.connected", () => {
  it.effect("reports success when credentials are stored", () =>
    Effect.gen(function* () {
      expect((yield* run("authenticated")).calls).toStrictEqual(["stop:Authentication successful!:0"])
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
        const { calls } = yield* run(item.stored)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toBe("stop:Authentication not confirmed:1")
        expect(calls[1]).toStartWith(`${item.level}:MCP server google_drive connected`)
        expect(calls[1]).toContain(item.text)
        expect(calls.join("\n")).not.toContain("Authentication successful!")
      }),
    )
  }
})
