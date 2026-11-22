import { test, expect, describe, spyOn } from "bun:test"
import { KilocodeConfigInjector } from "../../src/kilocode/config-injector"
import { McpMigrator } from "../../src/kilocode/mcp-migrator"
import { KilocodePaths } from "../../src/kilocode/paths"
import { tmpdir } from "../fixture/fixture"
import os from "os"
import path from "path"
import fs from "fs/promises"

describe("KilocodeConfigInjector", () => {
  describe("buildConfig", () => {
    test("returns empty config when no modes exist", async () => {
      await using tmp = await tmpdir()

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(result.configJson).toBe("{}")
      expect(result.warnings).toHaveLength(0)
    })

    test("includes custom modes in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate
    roleDefinition: You are a translator
    groups:
      - read
      - edit`,
          )
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })
      const config = JSON.parse(result.configJson)

      expect(config.agent).toBeDefined()
      expect(config.agent.translate).toBeDefined()
      expect(config.agent.translate.mode).toBe("primary")
      // A migrated mode carries no skill rule, so the injected config leaves the CLI default.
      expect("skill" in config.agent.translate.permission).toBe(false)
      expect(result.warnings).toEqual([])
    })

    test("adds warnings for skipped default modes", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: code
    name: Code
    roleDefinition: Default code
    groups:
      - read`,
          )
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain("code")
      expect(result.warnings[0]).toContain("skipped")
    })

    test("includes workflows as commands in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilocode", "workflows")
          await Bun.write(
            path.join(workflowsDir, "code-review.md"),
            "# Code Review\n\nPerform a code review.\n\n## Steps\n\n1. Review",
          )
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })
      const config = JSON.parse(result.configJson)

      expect(config.command).toBeDefined()
      expect(config.command["code-review"]).toBeDefined()
      expect(config.command["code-review"].template).toContain("# Code Review")
      expect(config.command["code-review"].description).toBe("Perform a code review.")
    })

    test("includes both modes and workflows in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Add a custom mode
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate
    roleDefinition: You are a translator
    groups:
      - read`,
          )
          // Add a workflow
          const workflowsDir = path.join(dir, ".kilocode", "workflows")
          await Bun.write(path.join(workflowsDir, "deploy.md"), "# Deploy\n\nDeploy the app.")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })
      const config = JSON.parse(result.configJson)

      expect(config.agent).toBeDefined()
      expect(config.agent.translate).toBeDefined()
      expect(config.command).toBeDefined()
      expect(config.command["deploy"]).toBeDefined()
    })

    test("includes rules in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilocode", "rules"), { recursive: true })
          await Bun.write(path.join(dir, ".kilocode", "rules", "main.md"), "# Rules")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })
      const config = JSON.parse(result.configJson)

      expect(config.instructions).toBeDefined()
      expect(config.instructions).toHaveLength(1)
      expect(config.instructions[0]).toContain("main.md")
    })

    test("skips rules when includeRules is false", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".kilocode", "rules"), { recursive: true })
          await Bun.write(path.join(dir, ".kilocode", "rules", "main.md"), "# Rules")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        includeRules: false,
      })
      const config = JSON.parse(result.configJson)

      expect(config.instructions).toBeUndefined()
    })

    test("combines modes, workflows, and rules in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Add custom mode
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate
    roleDefinition: You are a translator
    groups:
      - read`,
          )
          // Add workflow
          const workflowsDir = path.join(dir, ".kilocode", "workflows")
          await Bun.write(path.join(workflowsDir, "deploy.md"), "# Deploy\n\nDeploy the app.")
          // Add rules
          await fs.mkdir(path.join(dir, ".kilocode", "rules"), { recursive: true })
          await Bun.write(path.join(dir, ".kilocode", "rules", "main.md"), "# Rules")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })
      const config = JSON.parse(result.configJson)

      expect(config.agent).toBeDefined()
      expect(config.agent.translate).toBeDefined()
      expect(config.command).toBeDefined()
      expect(config.command["deploy"]).toBeDefined()
      expect(config.instructions).toBeDefined()
      expect(config.instructions).toHaveLength(1)
    })

    test("adds warnings for legacy rule files", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocoderules"), "# Legacy rules")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.warnings.some((w) => w.includes("Legacy"))).toBe(true)
    })

    test("includes ignore patterns in config", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/\n*.env")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })
      const config = JSON.parse(result.configJson)

      expect(config.permission).toBeDefined()
      expect(config.permission.read).toBeDefined()
      expect(config.permission.edit).toBeDefined()
      expect(config.permission.read["secrets/*"]).toBe("deny")
      expect(config.permission.read["*.env"]).toBe("deny")
    })

    test("skips ignore when includeIgnore is false", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        includeIgnore: false,
      })
      const config = JSON.parse(result.configJson)

      expect(config.permission).toBeUndefined()
    })

    test("combines ignore with other migrations", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Add custom mode
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate
    roleDefinition: You are a translator
    groups:
      - read`,
          )
          // Add ignore patterns
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })
      const config = JSON.parse(result.configJson)

      expect(config.agent).toBeDefined()
      expect(config.agent.translate).toBeDefined()
      expect(config.permission).toBeDefined()
      expect(config.permission.read["secrets/*"]).toBe("deny")
    })

    test("handles negation patterns in ignore file", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "*.env\n!.env.example")
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })
      const config = JSON.parse(result.configJson)

      expect(config.permission.read["*.env"]).toBe("deny")
      expect(config.permission.read[".env.example"]).toBe("allow")
    })

    test("grants the tools of every converted MCP server, project and global", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: mcpmode
    name: MCP mode
    roleDefinition: You are an MCP helper
    groups:
      - read
      - mcp`,
          )
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilocode", "mcp.json"),
            JSON.stringify({ mcpServers: { projectserver: { command: "npx" } } }),
          )
        },
      })
      await using home = await tmpdir()

      const homedir = spyOn(os, "homedir").mockReturnValue(home.path)
      // Windows resolves the global storage path from APPDATA first, so point both at the temp home.
      const appdata = process.env.APPDATA
      process.env.APPDATA = home.path
      try {
        const settings = path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "mcp_settings.json")
        await fs.mkdir(path.dirname(settings), { recursive: true })
        await Bun.write(settings, JSON.stringify({ mcpServers: { otherserver: { command: "npx" } } }))

        // A legacy mode's `mcp` group meant all MCP tools, so the grant follows every server
        // the same migration converted, whether it came from a project file or a global store.
        const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path })
        const config = JSON.parse(result.configJson)
        const permission = config.agent.mcpmode.permission

        expect(permission["projectserver_*"]).toBe("allow")
        expect(permission["otherserver_*"]).toBe("allow")
        expect(Object.keys(permission).sort()).toEqual([
          "bash",
          "browser_open",
          "edit",
          "otherserver_*",
          "projectserver_*",
          "read",
        ])
      } finally {
        homedir.mockRestore()
        if (appdata === undefined) delete process.env.APPDATA
        else process.env.APPDATA = appdata
      }
    })

    test("loads the MCP store once on the default path", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: mcpmode
    name: MCP mode
    roleDefinition: You are an MCP helper
    groups:
      - read
      - mcp`,
          )
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilocode", "mcp.json"),
            JSON.stringify({ mcpServers: { projectserver: { command: "npx" } } }),
          )
        },
      })
      await using home = await tmpdir()

      const homedir = spyOn(os, "homedir").mockReturnValue(home.path)
      const appdata = process.env.APPDATA
      process.env.APPDATA = home.path
      // Count the load passes: each pass re-reads the store and re-emits every MCP migration
      // warning through the log, so one pass is what keeps each message to one line.
      const real = McpMigrator.loadMcpConfig
      let passes = 0
      const spy = spyOn(McpMigrator, "loadMcpConfig").mockImplementation((dir: string, skip?: boolean) => {
        passes++
        return real(dir, skip)
      })
      try {
        const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path })

        expect(passes).toBe(1)
        // The one pass still feeds the mode migration: the project server is granted.
        const permission = JSON.parse(result.configJson).agent.mcpmode.permission
        expect(permission["projectserver_*"]).toBe("allow")
      } finally {
        spy.mockRestore()
        homedir.mockRestore()
        if (appdata === undefined) delete process.env.APPDATA
        else process.env.APPDATA = appdata
      }
    })

    test("grants a server that only a global MCP store declared", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: mcpmode
    name: MCP mode
    roleDefinition: You are an MCP helper
    groups:
      - read
      - mcp`,
          )
        },
      })
      await using home = await tmpdir()

      const homedir = spyOn(os, "homedir").mockReturnValue(home.path)
      const appdata = process.env.APPDATA
      process.env.APPDATA = home.path
      try {
        const settings = path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "mcp_settings.json")
        await fs.mkdir(path.dirname(settings), { recursive: true })
        await Bun.write(settings, JSON.stringify({ mcpServers: { globalserver: { command: "npx" } } }))

        // The same migration writes the global server to `mcp`, so the mode's grant names it and
        // there is nothing to report: the rule follows every converted server, not just project ones.
        const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path })
        const permission = JSON.parse(result.configJson).agent.mcpmode.permission

        expect(permission["globalserver_*"]).toBe("allow")
        expect(result.warnings.some((warning) => warning.includes("MCP access not migrated"))).toBe(false)
      } finally {
        homedir.mockRestore()
        if (appdata === undefined) delete process.env.APPDATA
        else process.env.APPDATA = appdata
      }
    })

    test("does not warn about MCP access when the project has no MCP server", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: mcpmode
    name: MCP mode
    roleDefinition: You are an MCP helper
    groups:
      - read
      - mcp`,
          )
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(result.warnings.some((warning) => warning.includes("MCP access not migrated"))).toBe(false)
      const config = JSON.parse(result.configJson)
      expect(Object.keys(config.agent.mcpmode.permission).some((key) => key.endsWith("_*"))).toBe(false)
    })

    test("warns about MCP access when the project's MCP server cannot be converted", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: mcpmode
    name: MCP mode
    roleDefinition: You are an MCP helper
    groups:
      - read
      - mcp`,
          )
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilocode", "mcp.json"),
            JSON.stringify({ mcpServers: { broken: { args: ["--no-command"] } } }),
          )
        },
      })

      const result = await KilocodeConfigInjector.buildConfig({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(
        result.warnings.filter((warning) => warning.includes("MCP access not migrated: no MCP server was migrated")),
      ).toEqual(["Mode 'mcpmode': MCP access not migrated: no MCP server was migrated"])
    })
  })

  describe("getEnvVars", () => {
    test("returns empty object for empty config", () => {
      const envVars = KilocodeConfigInjector.getEnvVars("{}")
      expect(envVars).toEqual({})
    })

    test("returns empty object for empty string", () => {
      const envVars = KilocodeConfigInjector.getEnvVars("")
      expect(envVars).toEqual({})
    })

    test("returns KILO_CONFIG_CONTENT for non-empty config", () => {
      const config = JSON.stringify({ agent: { test: {} } })
      const envVars = KilocodeConfigInjector.getEnvVars(config)

      expect(envVars).toEqual({
        KILO_CONFIG_CONTENT: config,
      })
    })
  })
})
