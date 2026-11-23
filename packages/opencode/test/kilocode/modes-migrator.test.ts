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
      expect("skill" in permissions).toBe(false)
      expect("mcp" in permissions).toBe(false)
    })

    test("maps browser group to browser_open permission", () => {
      const groups = ["browser"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.browser_open).toBe("allow")
      expect(permissions.bash).toBe("deny")
      expect(permissions.read).toBe("deny")
      expect(permissions.edit).toBe("deny")
      expect("skill" in permissions).toBe(false)
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
      expect("skill" in permissions).toBe(false)
      expect("mcp" in permissions).toBe(false)
    })

    test("denies the tools of every migrated MCP server when the mode has no mcp group", () => {
      const permissions = ModesMigrator.convertPermissions(["read"], ["github", "my server"], true)

      expect(permissions["github_*"]).toBe("deny")
      expect(permissions["my_server_*"]).toBe("deny")
      expect("skill" in permissions).toBe(false)
      expect(permissions.read).toBe("allow")
      expect("mcp" in permissions).toBe(false)
    })

    test("writes no server keys for an mcp group when no server was migrated", () => {
      const permissions = ModesMigrator.convertPermissions(["mcp"], [], false)

      expect(Object.keys(permissions).some((key) => key.endsWith("_*"))).toBe(false)
      expect("skill" in permissions).toBe(false)
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
      expect("skill" in permissions).toBe(false)
    })

    test("asks for a permission whose fileRegex cannot be translated", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { fileRegex: "[0-9]+\\.md$" }]]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.edit).toBe("ask")
      expect(permissions.read).toBe("deny")
    })

    test("asks for a permission whose fileRegex is only digits", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { fileRegex: "^123$" }]]
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
      expect("skill" in permissions).toBe(false)
    })

    test("handles tuple without fileRegex", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", {}]]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.edit).toBe("allow")
      expect(permissions.read).toBe("deny")
      expect(permissions.bash).toBe("deny")
      expect("skill" in permissions).toBe(false)
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
      expect("skill" in permissions).toBe(false)
    })

    test("denies bash and browser when only read and edit are allowed", () => {
      const groups = ["read", "edit"]
      const permissions = ModesMigrator.convertPermissions(groups, [], false)

      expect(permissions.read).toBe("allow")
      expect(permissions.edit).toBe("allow")
      expect(permissions.bash).toBe("deny")
      expect(permissions.browser_open).toBe("deny")
      expect("skill" in permissions).toBe(false)
      expect("mcp" in permissions).toBe(false)
    })

    test("keeps the file restriction when an allow group repeats it", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = ["edit", ["edit", { fileRegex: "^src/.*$" }]]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.edit).toEqual({ "*": "deny", "src/*": "allow" })
      expect(converted.warnings).toEqual(["Repeated group; edit kept its file restriction"])
    })

    test("keeps the file restriction when the allow group comes second", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { fileRegex: "^src/.*$" }], "edit"]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.edit).toEqual({ "*": "deny", "src/*": "allow" })
      expect(converted.warnings).toEqual(["Repeated group; edit kept its file restriction"])
    })

    test("asks when a repeated group is an untranslatable file restriction", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["read", { fileRegex: "[a-z]+\\.ts$" }], "read"]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.read).toBe("ask")
      expect(converted.warnings).toEqual([
        "File restriction not migrated; read set to ask: [a-z]+\\.ts$",
        "Repeated group; read set to ask",
      ])
    })

    test("asks when two different file restrictions repeat the same group", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [
        ["edit", { fileRegex: "^src/.*$" }],
        ["edit", { fileRegex: "^test/.*$" }],
      ]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.edit).toBe("ask")
      expect(converted.warnings).toEqual(["Repeated group; edit set to ask"])
    })

    test("stays silent when a group is listed once or repeated with the same value", () => {
      const once = ModesMigrator.convertWithMessages(["edit"], [], false)
      const repeated = ModesMigrator.convertWithMessages(["edit", "edit"], [], false)
      const repeatedRestriction = ModesMigrator.convertWithMessages(
        [
          ["edit", { fileRegex: "^src/.*$" }],
          ["edit", { fileRegex: "^src/.*$" }],
        ],
        [],
        false,
      )

      expect(once.warnings).toEqual([])
      expect(repeated.warnings).toEqual([])
      expect(repeated.permission.edit).toBe("allow")
      expect(repeatedRestriction.warnings).toEqual([])
      expect(repeatedRestriction.permission.edit).toEqual({ "*": "deny", "src/*": "allow" })
    })

    test("keeps the answer of a repeated restricted mcp group for every server", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["mcp", { fileRegex: "\\.md$" }], "mcp"]
      const converted = ModesMigrator.convertWithMessages(groups, ["demo"], true)

      expect(converted.permission["demo_*"]).toBe("ask")
      expect(converted.warnings).toEqual([
        "File restriction not migrated; mcp set to ask: \\.md$",
        "Repeated group; demo_* set to ask",
      ])
    })

    test("asks for the edit group whose options parsed as their own item", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = ["edit", { fileRegex: "^docs/" }]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.edit).toBe("ask")
      expect(converted.warnings).toEqual(["Group options not migrated; edit set to ask"])
    })

    test("asks for the read group whose options parsed as their own item", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = ["read", { fileRegex: "^docs/" }]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.read).toBe("ask")
      expect(converted.warnings).toEqual(["Group options not migrated; read set to ask"])
    })

    test("asks for every server key when the mcp group options parsed as their own item", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = ["mcp", { fileRegex: "^docs/" }]
      const converted = ModesMigrator.convertWithMessages(groups, ["demo"], true)

      expect(converted.permission["demo_*"]).toBe("ask")
      expect(converted.warnings).toEqual(["Group options not migrated; mcp set to ask"])
    })

    test("ignores a leading bare mapping with no group name before it", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [{ fileRegex: "^docs/" }, "read"]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.read).toBe("allow")
      expect(converted.warnings).toEqual([])
    })

    test("keeps the nested tuple path for a restricted edit group", () => {
      const groups: ModesMigrator.KilocodeMode["groups"] = [["edit", { fileRegex: "^docs/" }]]
      const converted = ModesMigrator.convertWithMessages(groups, [], false)

      expect(converted.permission.edit).toEqual({ "*": "deny", "docs/*": "allow" })
      expect(converted.warnings).toEqual([])
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
      const converted = ModesMigrator.convertOrganizationMode(mode)
      expect(converted.agent.displayName).toBe("Code Review custom Agent")
      expect(converted.agent.source).toBe("organization")
      // The metadata must never live in `options`, which is forwarded to the provider.
      expect(converted.agent.options).toBeUndefined()
      expect(converted.notes).toEqual([])
    })

    test("reports the mcp group of an organization mode as a note, without server keys", () => {
      const converted = ModesMigrator.convertOrganizationMode({
        ...mode,
        config: { roleDefinition: "You are a reviewer.", groups: ["read", "mcp"] },
      })
      const permission = converted.agent.permission ?? {}

      expect(converted.notes).toEqual([
        "MCP access is not scoped to this agent: no MCP servers are attached at config load",
      ])
      expect(Object.keys(permission).some((key) => key.endsWith("_*"))).toBe(false)
      expect(permission.bash).toBe("deny")
      expect(permission.edit).toBe("deny")
      expect(permission.read).toBe("allow")
    })

    test("reports no note for an organization mode without an mcp group", () => {
      const converted = ModesMigrator.convertOrganizationMode(mode)

      expect(converted.notes).toEqual([])
      expect(converted.agent.permission?.read).toBe("allow")
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

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

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
        mcpAvailable: false,
      })

      expect(result.agents.translate.prompt).toBe("Project translator")
    })

    test("returns empty agents when no custom modes exist", async () => {
      await using tmp = await tmpdir()

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

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

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

      expect(Object.keys(result.agents)).toHaveLength(2)
      expect(result.agents).toHaveProperty("translate")
      expect(result.agents).toHaveProperty("reviewer")
    })

    test("leaves the skill rule to the CLI default", async () => {
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
      - edit`,
          )
        },
      })

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

      expect("skill" in (result.agents.translate.permission ?? {})).toBe(false)
      expect(result.warnings).toEqual([])
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
        mcpAvailable: true,
      })

      expect(result.agents.helper.permission?.["github_*"]).toBe("allow")
      expect("mcp" in (result.agents.helper.permission ?? {})).toBe(false)
      expect(result.warnings).toEqual([])
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

      expect(result.warnings.some((warning) => warning.message.includes("MCP access not migrated"))).toBe(false)
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

      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'helper': MCP access not migrated: no MCP server was migrated",
      ])
      expect(result.warnings[0].path).toBe(path.join(tmp.path, ".kilocodemodes"))
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

      const mcp = "Mode 'helper': MCP access not migrated: no MCP server was migrated"

      expect(declared.warnings.map((warning) => warning.message)).toEqual([mcp])
      expect(undeclared.warnings).toEqual([])
      for (const result of [declared, undeclared]) {
        expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
        expect(result.agents.helper.permission?.read).toBe("allow")
      }
    })

    test("reports an incomplete mcp group even when a project server was migrated", async () => {
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
        mcpServers: ["projectserver"],
        mcpAvailable: false,
        mcpSkippedGlobalServers: ["globalserver"],
      })

      // The migrated server is still granted: only the skipped store's servers are missing.
      expect(result.agents.helper.permission?.["projectserver_*"]).toBe("allow")
      const messages = result.warnings.map((warning) => warning.message)
      expect(messages).toEqual([
        "Mode 'helper': MCP access incomplete: a global store this load skipped declared MCP servers",
      ])
    })

    test("reports only the incomplete message when nothing was migrated and the store was skipped", async () => {
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
        mcpServers: [],
        mcpAvailable: false,
        mcpSkippedGlobalServers: ["globalserver"],
      })

      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'helper': MCP access incomplete: a global store this load skipped declared MCP servers",
      ])
      expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
    })

    // The two facts are independent: a store this load read that declared a server none
    // converted reports its own message beside the skipped store's, in that order.
    test("reports both facts when the skipped store lost a server and nothing was migrated", async () => {
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
        mcpServers: [],
        mcpAvailable: true,
        mcpSkippedGlobalServers: ["globalserver"],
      })

      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'helper': MCP access incomplete: a global store this load skipped declared MCP servers",
        "Mode 'helper': MCP access not migrated: no MCP server was migrated",
      ])
      expect(Object.keys(result.agents.helper.permission ?? {}).some((key) => key.endsWith("_*"))).toBe(false)
    })

    // A skipped server the migrated set already names is covered, so the group lost nothing.
    test("stays silent when the skipped store's server was migrated anyway", async () => {
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
        mcpServers: ["globalserver"],
        mcpAvailable: true,
        mcpSkippedGlobalServers: ["globalserver"],
      })

      expect(result.warnings).toEqual([])
      expect(result.agents.helper.permission?.["globalserver_*"]).toBe("allow")
    })

    // Coverage is by permission key, not raw name: `a.b` and `a_b` name one `<server>_*` key, so
    // the migrated `a_b` covers the skipped `a.b` and the group lost nothing.
    test("stays silent for a skipped server whose permission key a migrated server supplies", async () => {
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
        mcpServers: ["a_b"],
        mcpAvailable: true,
        mcpSkippedGlobalServers: ["a.b"],
      })

      expect(result.warnings).toEqual([])
      expect(result.agents.helper.permission?.["a_b_*"]).toBe("allow")
    })

    // The key comparison covers only names that share a key: a skipped server no migrated server
    // covers is still reported, so the change is not a blanket silence.
    test("reports a skipped server no migrated server's permission key covers", async () => {
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
        mcpServers: ["a_b"],
        mcpAvailable: true,
        mcpSkippedGlobalServers: ["other"],
      })

      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'helper': MCP access incomplete: a global store this load skipped declared MCP servers",
      ])
      expect(result.agents.helper.permission?.["a_b_*"]).toBe("allow")
    })

    test("keeps the existing message when no store was skipped", async () => {
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
        mcpServers: [],
        mcpAvailable: true,
        mcpSkippedGlobalServers: [],
      })

      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'helper': MCP access not migrated: no MCP server was migrated",
      ])
      expect(result.warnings.some((warning) => warning.message.includes("MCP access incomplete"))).toBe(false)
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

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

      expect(result.agents.docs.permission?.edit).toBe("ask")
      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "Mode 'docs': File restriction not migrated; edit set to ask: [0-9]+\\.md$",
      ])
      expect(result.warnings[0].path).toBe(path.join(tmp.path, ".kilocodemodes"))
    })

    test("asks for a file restriction whose pattern is only digits", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodemodes"),
            `customModes:
  - slug: numbered
    name: Numbered
    roleDefinition: Numbered
    groups:
      - - edit
        - fileRegex: "^123$"`,
          )
        },
      })

      const result = await ModesMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true, mcpAvailable: false })

      expect(result.agents.numbered.permission?.edit).toBe("ask")
      expect(result.warnings[0].message).toContain("Mode 'numbered'")
      expect(result.warnings[0].message).toContain("ask")
      expect(result.warnings[0].message).toContain("^123$")
    })
  })
})
