import { describe, expect, test } from "bun:test"
import path from "path"

const root = path.join(__dirname, "..", "..")

describe("Kilo OAuth branding", () => {
  test("Codex OAuth browser flow uses Kilo branding", async () => {
    const src = await Bun.file(path.join(root, "src", "plugin", "openai", "codex.ts")).text()

    expect(src).toContain('originator: "kilo"')
    expect(src).toContain('"User-Agent": `kilo/${InstallationVersion}`')
    expect(src).toContain("return to Kilo")
    expect(src).not.toContain('originator: "opencode"')
    expect(src).not.toContain("return to OpenCode")
  })

  test("MCP OAuth callback page uses Kilo branding", async () => {
    const src = await Bun.file(path.join(root, "src", "mcp", "oauth-callback.ts")).text()

    expect(src).toContain("return to Kilo")
    expect(src).not.toContain("return to OpenCode")
  })
})
