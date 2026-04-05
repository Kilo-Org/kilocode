import { describe, it, expect, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MarketplaceInstaller } from "../../src/services/marketplace/installer"
import { MarketplacePaths } from "../../src/services/marketplace/paths"

const tmpDir = path.join(os.tmpdir(), `kilo-test-${Date.now()}`)

class TestPaths extends MarketplacePaths {
  override configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "global") return path.join(tmpDir, "global", "kilo.json")
    return path.join(tmpDir, "project", ".kilo", "kilo.json")
  }
  override skillsDir(scope: "project" | "global", workspace?: string): string {
    return path.join(tmpDir, "skills")
  }
}

describe("MarketplaceInstaller MCP format normalization", () => {
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true }).catch(() => {})
  })

  it("converts local command+args+env format to CLI format", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "memory",
      name: "Memory",
      description: "test",
      url: "https://example.com",
      content: JSON.stringify({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        env: { MY_KEY: "my-value" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.memory
    expect(mcp.type).toBe("local")
    expect(mcp.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"])
    expect(mcp.environment).toEqual({ MY_KEY: "my-value" })
    expect(mcp.args).toBeUndefined()
    expect(mcp.env).toBeUndefined()
  })

  it("converts sse type to remote type", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "myremote",
      name: "Remote",
      description: "test",
      url: "https://example.com",
      content: JSON.stringify({
        type: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer token" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.myremote
    expect(mcp.type).toBe("remote")
    expect(mcp.url).toBe("https://example.com/sse")
    expect(mcp.headers).toEqual({ Authorization: "Bearer token" })
  })

  it("keeps already-normalized local format unchanged", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "already",
      name: "Already Done",
      description: "test",
      url: "https://example.com",
      content: JSON.stringify({
        type: "local",
        command: ["npx", "-y", "someserver"],
        environment: { KEY: "val" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.already
    expect(mcp).toEqual({ type: "local", command: ["npx", "-y", "someserver"], environment: { KEY: "val" } })
  })
})
