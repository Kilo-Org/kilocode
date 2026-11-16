import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { KilocodeMcpAuth } from "@/kilocode/cli/cmd/mcp"
import type { MCP } from "@/mcp"

function run(stored: MCP.AuthStatus) {
  const calls: string[] = []
  return Effect.runPromise(
    KilocodeMcpAuth.connected({
      mcp: { getAuthStatus: () => Effect.succeed(stored) },
      serverName: "google_drive",
      spinner: { stop: (message, code) => calls.push(`stop:${message}:${code ?? 0}`) },
      prompts: { log: { error: (message) => calls.push(`error:${message}`) } },
    }),
  ).then(() => calls)
}

describe("KilocodeMcpAuth.connected", () => {
  test("reports success when credentials are stored", async () => {
    expect(await run("authenticated")).toStrictEqual(["stop:Authentication successful!:0"])
  })

  const cases: MCP.AuthStatus[] = ["not_authenticated", "expired"]
  test.each(cases)("reports no authentication when stored status is %s", async (stored) => {
    const calls = await run(stored)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe("stop:Authentication not performed:1")
    expect(calls[1]).toStartWith("error:MCP server google_drive connected without requesting OAuth")
    expect(calls[1]).toContain("no credentials were stored")
    expect(calls.join("\n")).not.toContain("Authentication successful!")
  })
})

describe("McpAuthCommand", () => {
  // A subprocess test cannot reach the "connected without a 401" branch without a live OAuth-less
  // MCP server, so guard the wiring of the shared command to the helper instead.
  test("routes connected results through the credential check", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "../../../../src/cli/cmd/mcp.ts")).text()
    const block = source.slice(
      source.indexOf("Effect.tap((status)"),
      source.indexOf("Effect.catchCause", source.indexOf("Effect.tap((status)")),
    )
    expect(block).toContain('if (status.status === "connected") {\n            yield* KilocodeMcpAuth.connected(')
    expect(block).not.toContain("Authentication successful!")
  })
})
