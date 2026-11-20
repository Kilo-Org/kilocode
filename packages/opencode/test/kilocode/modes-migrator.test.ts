import { test, expect, describe } from "bun:test"
import { ModesMigrator } from "../../src/kilocode/modes-migrator"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("ModesMigrator", () => {
  describe("isDefaultMode", () => {
    test("returns true for default modes", () => {
      expect(ModesMigrator.isDefaultMode("code")).toBe(true)
      expect(ModesMigrator.isDefaultMode("architect")).toBe(true)
      expect(ModesMigrator.isDefaultMode("ask")).toBe(true)
      expect(ModesMigrator.isDefaultMode("debug")).toBe(true)
      expect(ModesMigrator.isDefaultMode("orchestrator")).toBe(true)
    })

    test("returns false for custom modes", () => {
      expect(ModesMigrator.isDefaultMode("translate")).toBe(false)
      expect(ModesMigrator.isDefaultMode("my-custom-mode")).toBe(false)
      expect(ModesMigrator.isDefaultMode("reviewer")).toBe(false)
    })
  })

  describe("convertPermissions", () => {
    test("converts simple groups to permissions and denies missing", () => {
      const groups = ["read", "edit", "command"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toBe("allow")
      expect(permissions.bash).toBe("allow")
      expect(permissions.browser_open).toBe("deny")
      expect(permissions.skill).toBe("deny")
      expect("mcp" in permissions).toBe(false)
    })

    test("maps browser group to browser_open permission", () => {
      const groups = ["browser"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.browser_open).toBe("allow")
      expect(permissions.bash).toBe("deny")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.skill).toBe("deny")
    })

    test("grants the tools of every migrated MCP server for an mcp group", () => {
      const groups = ["mcp"]
      const permissions = ModesMigrator.convertPermissions(groups, ["github", "my server"], true)

      expect(permissions["github_*"]).toBe("allow")
      expect(permissions["my_server_*"]).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect(permissions.browser_open).toBe("deny")
      expect(permissions.skill).toBe("deny")
      expect("mcp" in permissions).toBe(false)
    })

    test("denies the tools of every migrated MCP server when the mode has no mcp group", () => {
      const permissions = ModesMigrator.convertPermissions(["read"], ["github", "my server"], true)

      expect(permissions["github_*"]).toBe("deny")
      expect(permissions["my_server_*"]).toBe("deny")
      expect(permissions.skill).toBe("deny")
      expect(permissions.read).toBe("allow")
      expect("mcp" in permissions).toBe(false)
    })

    test("writes no server keys for an mcp group when no server was migrated", () => {
      const permissions = ModesMigrator.convertPermissions(["mcp"], [], false)

      expect(Object.keys(permissions).some((key) => key.endsWith("_*"))).toBe(false)
      expect(permissions.skill).toBe("deny")
    })

    test("converts fileRegex groups to restricted permissions", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [
        "read",
        ["edit", { fileRegex: "\\.md$", description: "Markdown only" }],
      ]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toEqual({ "*": "deny", "*.md": "allow" })
      expect(Object.keys(permissions.edit as Record<string, string>)[0]).toBe("*")
      expect(permissions.bash).toBe("deny")
      expect(permissions.skill).toBe("deny")
    })

    test("asks for a permission whose fileRegex cannot be translated", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { fileRegex: "[0-9]+\\.md$" }]]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.edit).toBe("ask")
      expect(permissions.read).toBe("deny")
    })

    test("asks for a permission whose group options cannot be read", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { regex: "\\.md$" }]]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.edit).toBe("ask")
      expect(permissions.read).toBe("deny")
    })

    test("asks for every server key when an mcp group carries a fileRegex", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["mcp", { fileRegex: "\\.md$" }]]
      const permissions = ModesMigrator.convertPermissions(groups, ["github", "my server"], true)

      expect(permissions["github_*"]).toBe("ask")
      expect(permissions["my_server_*"]).toBe("ask")
      expect(permissions.skill).toBe("deny")
    })

    test("handles tuple without fileRegex", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", {}]]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.edit).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect(permissions.skill).toBe("deny")
      expect("mcp" in permissions).toBe(false)
    })

    test("ignores unknown groups but still denies standard permissions", () => {
      const groups = ["custom-group"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions["custom-group"]).toBeUndefined()
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect(permissions.browser_open).toBe("deny")
      expect(permissions.skill).toBe("deny")
    })

    test("denies bash, browser and skill when only read and edit are allowed", () => {
      const groups = ["read", "edit"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toBe("allow")
      expect(permissions.bash).toBe("deny")
      expect(permissions.browser_open).toBe("deny")
      expect(permissions.skill).toBe("deny")
      expect("mcp" in permissions).toBe(false)
    })
  })

  describe("convertMode", () => {
    test("converts full mode to agent config", () => {
      const mode: ModesMigrator.KilocodeMode = {
        slug: "translate",
        name: "Translate",
        roleDefinition: "You are a translator...",
        customInstructions: "Translate accurately.",
        groups: ["read", ["edit", { fileRegex: "\\.json$" }]],
      }

      const agent = ModesMigrator.convertMode(mode, [], false)

      expect(agent.mode).toBe("primary")
      expect(agent.prompt).toBe("You are a translator...\n\nTranslate accurately.")
      expect(agent.permission?.read).toBe("allow")
      expect(agent.permission?.edit).toEqual({ "*": "deny", "*.json": "allow" })
    })

    test("uses description when available", () => {
      const mode: ModesMigrator.KilocodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "Role",
        description: "Custom description",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode, [], false)
      expect(agent.description).toBe("Custom description")
    })

    test("falls back to whenToUse for description", () => {
      const mode: ModesMigrator.KilocodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "Role",
        whenToUse: "When to use this mode",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode, [], false)
      expect(agent.description).toBe("When to use this mode")
    })

    test("falls back to name for description", () => {
      const mode: ModesMigrator.KilocodeMode = {
        slug: "test",
        name: "Test Mode",
        roleDefinition: "Role",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode, [], false)
      expect(agent.description).toBe("Test Mode")
    })

    test("handles mode without customInstructions", () => {
      const mode: ModesMigrator.KilocodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "You are a test agent.",
        groups: ["read"],
      }

      const agent = ModesMigrator.convertMode(mode, [], false)
      expect(agent.prompt).toBe("You are a test agent.")
    })
  })

  describe("convertOrganizationMode", () => {
    const mode = {
      id: "11111111-1111-1111-1111-111111111111",
      organization_id: "org-1",
      name: "Code Review custom Agent",
      slug: "code-review",
      created_by: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      config: {
        roleDefinition: "You are a reviewer.",
        groups: ["read"],
      },
    }

    test("carries displayName and source as typed fields, not provider options", () => {
      const agent = ModesMigrator.convertOrganizationMode(mode)
      expect(agent.displayName).toBe("Code Review custom Agent")
      expect(agent.source).toBe("organization")
      // The metadata must never live in `options`, which is forwarded to the provider.
      expect(agent.options).toBeUndefined()
    })
  })

  describe("readModesFile", () => {
    test("returns empty array for non-existent file", async () => {
      const modes = await ModesMigrator.readModesFile("/non/existent/path.yaml")
      expect(modes).toEqual([])
    })

    test("reads and parses yaml file", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "modes.yaml"),
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

      const modes = await ModesMigrator.readModesFile(path.join(tmp.path, "modes.yaml"))
      expect(modes).toHaveLength(1)
      expect(modes[0].slug).toBe("translate")
      expect(modes[0].name).toBe("Translate")
    })

    test("returns empty array for file without customModes", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "modes.yaml"), "someOtherKey: value")
        },
      })

      const modes = await ModesMigrator.readModesFile(path.join(tmp.path, "modes.yaml"))
      expect(modes).toEqual([])
    })
  })

  describe("migrate", () => {
    test("skips default modes", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: code
    name: Code
    roleDefinition: Default code mode
    groups:
      - read
      - edit
  - slug: translate
    name: Translate
    roleDefinition: Custom translator
    groups:
      - read`,
          )
        },
      })

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].slug).toBe("code")
      expect(result.agents).toHaveProperty("translate")
      expect(result.agents).not.toHaveProperty("code")
    })

    test("deduplicates modes by slug with later entries winning", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create global settings dir
          const globalDir = path.join(dir, "global-settings")
          await Bun.write(
            path.join(globalDir, "custom_modes.yaml"),
            `customModes:
  - slug: translate
    name: Translate Global
    roleDefinition: Global translator
    groups:
      - read`,
          )

          // Create project .kilocodemodes (should win)
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate Project
    roleDefinition: Project translator
    groups:
      - read
      - edit`,
          )

          return globalDir
        },
      })

      const result = await ModesMigrator.migrate({
        projectDir: tmp.path,
        globalSettingsDir: tmp.extra,
      })

      expect(result.agents.translate.prompt).toBe("Project translator")
    })

    test("returns empty agents when no custom modes exist", async () => {
      await using tmp = await tmpdir()

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.agents)).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)
    })

    test("migrates multiple custom modes", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: translate
    name: Translate
    roleDefinition: Translator
    groups:
      - read
  - slug: reviewer
    name: Reviewer
    roleDefinition: Code reviewer
    groups:
      - read
      - edit`,
          )
        },
      })

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.agents)).toHaveLength(2)
      expect(result.agents).toHaveProperty("translate")
      expect(result.agents).toHaveProperty("reviewer")
    })

    test("grants an mcp group the tools of the migrated servers it was given", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: helper
    name: Helper
    roleDefinition: Helper
    groups:
      - read
      - mcp`,
          )
        },
      })

      const result = await ModesMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        mcpServers: ["github"],
      })

      expect(result.agents.helper.permission?.["github_*"]).toBe("allow")
      expect("mcp" in (result.agents.helper.permission ?? {})).toBe(false)
      expect(result.warnings).toHaveLength(0)
    })

    test("stays silent for an mcp group when the legacy store had no MCP server", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: helper
    name: Helper
    roleDefinition: Helper
    groups:
      - read
      - mcp`,
          )
        },
      })

      const result = await ModesMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        mcpAvailable: false,
      })

      expect(result.warnings).toHaveLength(0)
      expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
    })

    test("warns once for an mcp group when the legacy store had an unconvertible MCP server", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: helper
    name: Helper
    roleDefinition: Helper
    groups:
      - read
      - mcp`,
          )
        },
      })

      const result = await ModesMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        mcpAvailable: true,
      })

      expect(result.warnings).toEqual(["Mode 'helper': MCP access not migrated: no MCP server was migrated"])
      expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
    })

    test("warns for an mcp group only when the legacy store declared an MCP server", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: helper
    name: Helper
    roleDefinition: Helper
    groups:
      - read
      - mcp`,
          )
        },
      })

      const declared = await ModesMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        mcpAvailable: true,
      })
      const undeclared = await ModesMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
        mcpAvailable: false,
      })

      expect(declared.warnings).toEqual(["Mode 'helper': MCP access not migrated: no MCP server was migrated"])
      expect(undeclared.warnings).toHaveLength(0)
      for (const result of [declared, undeclared]) {
        expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
        expect(result.agents.helper.permission?.read).toBe("allow")
      }
    })

    test("reports a mode warning for a fileRegex that cannot be translated", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: docs
    name: Docs
    roleDefinition: Docs
    groups:
      - - edit
        - fileRegex: "[0-9]+\\\\.md$"`,
          )
        },
      })

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(result.agents.docs.permission?.edit).toBe("ask")
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain("docs")
      expect(result.warnings[0]).toContain("ask")
    })
  })
})
