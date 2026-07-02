import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "../../src/config/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { McpMigrator } from "../../src/kilocode/mcp-migrator"
import { Filesystem } from "../../src/util/filesystem"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"

const load = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
const warnings = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.warnings()))

afterEach(async () => {
  await disposeAllInstances()
  await AppRuntime.runPromise(Config.Service.use((svc) => svc.invalidate()))
})

describe("McpMigrator.loadExternalMcpConfig", () => {
  test("converts local and remote servers from a shared .mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              filesystem: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
                env: { NODE_ENV: "production" },
              },
              docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
              bare: { url: "https://bare.example.com/mcp" },
            },
          }),
        )
      },
    })

    const result = await McpMigrator.loadExternalMcpConfig({ files: [".mcp.json"], root: tmp.path })

    expect(result.warnings).toEqual([])
    expect(result.mcp.filesystem).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      environment: { NODE_ENV: "production" },
    })
    // `type: "http"` and a bare `url` (no command) are both treated as remote.
    expect(result.mcp.docs).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    })
    expect(result.mcp.bare).toEqual({ type: "remote", url: "https://bare.example.com/mcp" })
  })

  test("supports JSONC comments and absolute paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "shared.jsonc"),
          `{
            // servers shared across agents
            "mcpServers": { "tool": { "command": "my-tool" } },
          }`,
        )
      },
    })

    const result = await McpMigrator.loadExternalMcpConfig({
      files: [path.join(tmp.path, "shared.jsonc")],
      root: tmp.path,
    })

    expect(result.warnings).toEqual([])
    expect(result.mcp.tool).toEqual({ type: "local", command: ["my-tool"] })
  })

  test("later files win for duplicate server names", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "a.json"), JSON.stringify({ mcpServers: { dup: { command: "a" } } }))
        await Filesystem.write(path.join(dir, "b.json"), JSON.stringify({ mcpServers: { dup: { command: "b" } } }))
      },
    })

    const result = await McpMigrator.loadExternalMcpConfig({ files: ["a.json", "b.json"], root: tmp.path })

    expect(result.mcp.dup).toEqual({ type: "local", command: ["b"] })
  })

  test("warns when a referenced file is missing", async () => {
    await using tmp = await tmpdir()

    const result = await McpMigrator.loadExternalMcpConfig({ files: ["nope.json"], root: tmp.path })

    expect(Object.keys(result.mcp)).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain("file not found")
  })

  test("warns when the file is not valid JSON", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "broken.json"), "{ not json !!!")
      },
    })

    const result = await McpMigrator.loadExternalMcpConfig({ files: ["broken.json"], root: tmp.path })

    expect(result.warnings[0].message).toContain("not valid JSON")
  })
})

describe("mcpConfig.file integration", () => {
  test("loads MCP servers referenced by mcpConfig.file", async () => {
    await using tmp = await tmpdir({
      config: { mcpConfig: { file: ".mcp.json" } },
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({ mcpServers: { shared: { command: "npx", args: ["-y", "server"] } } }),
        )
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()
        expect(cfg.mcp?.shared).toEqual({ type: "local", command: ["npx", "-y", "server"] })
      },
    })
  })

  test("inline mcp entries override the external file by name", async () => {
    await using tmp = await tmpdir({
      config: {
        mcpConfig: { file: ".mcp.json" },
        mcp: { shared: { type: "local", command: ["local-override"] } },
      },
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({ mcpServers: { shared: { command: "from-file" }, extra: { command: "extra" } } }),
        )
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()
        expect(cfg.mcp?.shared).toEqual({ type: "local", command: ["local-override"] })
        expect(cfg.mcp?.extra).toEqual({ type: "local", command: ["extra"] })
      },
    })
  })

  test("accepts an array of files", async () => {
    await using tmp = await tmpdir({
      config: { mcpConfig: { file: [".mcp.json", "team.json"] } },
      init: async (dir) => {
        await Filesystem.write(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { one: { command: "one" } } }))
        await Filesystem.write(path.join(dir, "team.json"), JSON.stringify({ mcpServers: { two: { command: "two" } } }))
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()
        expect(cfg.mcp?.one).toEqual({ type: "local", command: ["one"] })
        expect(cfg.mcp?.two).toEqual({ type: "local", command: ["two"] })
      },
    })
  })

  test("surfaces a warning for a missing referenced file", async () => {
    await using tmp = await tmpdir({
      config: { mcpConfig: { file: "missing.json" } },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()
        expect(
          warns.some((w) => w.path.includes("missing.json") && w.message.includes("Could not load MCP config file")),
        ).toBe(true)
      },
    })
  })
})
