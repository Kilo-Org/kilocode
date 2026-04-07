import { test, expect, describe } from "bun:test"
import { ModesMigrator } from "../../src/devilcode/modes-migrator"
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
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toBe("allow")
      expect(permissions.bash).toBe("allow")
      expect(permissions.mcp).toBe("deny") // Not in groups, should be denied
    })

    test("maps browser group to bash permission", () => {
      const groups = ["browser"]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.bash).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.mcp).toBe("deny")
    })

    test("maps mcp group to mcp permission", () => {
      const groups = ["mcp"]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.mcp).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.bash).toBe("deny")
    })

    test("converts fileRegex groups to restricted permissions", () => {
      const groups: ModesMigrator.DevilcodeMode["groups"] = [
        "read",
        ["edit", { fileRegex: "\\.md$", description: "Markdown only" }],
      ]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toEqual({
        "\\.md$": "allow",
        "*": "deny",
      })
      expect(permissions.bash).toBe("deny")
      expect(permissions.mcp).toBe("deny")
    })

    test("handles tuple without fileRegex", () => {
      const groups: ModesMigrator.DevilcodeMode["groups"] = [["edit", {}]]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.edit).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect(permissions.mcp).toBe("deny")
    })

    test("passes through unknown groups but still denies standard permissions", () => {
      const groups = ["custom-group"]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions["custom-group"]).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect(permissions.mcp).toBe("deny")
    })

    test("denies bash and mcp when only read and edit are allowed", () => {
      const groups = ["read", "edit"]
      const permissions = ModesMigrator.convertPermissions(groups)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toBe("allow")
      expect(permissions.bash).toBe("deny")
      expect(permissions.mcp).toBe("deny")
    })
  })

  describe("convertMode", () => {
    test("converts full mode to agent config", () => {
      const mode: ModesMigrator.DevilcodeMode = {
        slug: "translate",
        name: "Translate",
        roleDefinition: "You are a translator...",
        customInstructions: "Translate accurately.",
        groups: ["read", ["edit", { fileRegex: "\\.json$" }]],
      }

      const agent = ModesMigrator.convertMode(mode)

      expect(agent.mode).toBe("primary")
      expect(agent.prompt).toBe("You are a translator...\n\nTranslate accurately.")
      expect(agent.permission?.read).toBe("allow")
      expect(agent.permission?.edit).toEqual({
        "\\.json$": "allow",
        "*": "deny",
      })
    })

    test("uses description when available", () => {
      const mode: ModesMigrator.DevilcodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "Role",
        description: "Custom description",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode)
      expect(agent.description).toBe("Custom description")
    })

    test("falls back to whenToUse for description", () => {
      const mode: ModesMigrator.DevilcodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "Role",
        whenToUse: "When to use this mode",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode)
      expect(agent.description).toBe("When to use this mode")
    })

    test("falls back to name for description", () => {
      const mode: ModesMigrator.DevilcodeMode = {
        slug: "test",
        name: "Test Mode",
        roleDefinition: "Role",
        groups: [],
      }

      const agent = ModesMigrator.convertMode(mode)
      expect(agent.description).toBe("Test Mode")
    })

    test("handles mode without customInstructions", () => {
      const mode: ModesMigrator.DevilcodeMode = {
        slug: "test",
        name: "Test",
        roleDefinition: "You are a test agent.",
        groups: ["read"],
      }

      const agent = ModesMigrator.convertMode(mode)
      expect(agent.prompt).toBe("You are a test agent.")
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
            path.join(dir, ".devilcodemodes"),
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

          // Create project .devilcodemodes (should win)
          await Bun.write(
            path.join(dir, ".devilcodemodes"),
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
            path.join(dir, ".devilcodemodes"),
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
  })
})
