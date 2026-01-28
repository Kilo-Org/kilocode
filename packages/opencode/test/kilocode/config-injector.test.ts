import { test, expect, describe } from "bun:test"
import { KilocodeConfigInjector } from "../../src/kilocode/config-injector"
import { tmpdir } from "../fixture/fixture"
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

    // kilocode_change start - Rules migration tests
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
    // kilocode_change end

    // kilocode_change start - Ignore migration tests
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
    // kilocode_change end
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

    test("returns OPENCODE_CONFIG_CONTENT for non-empty config", () => {
      const config = JSON.stringify({ agent: { test: {} } })
      const envVars = KilocodeConfigInjector.getEnvVars(config)

      expect(envVars).toEqual({
        OPENCODE_CONFIG_CONTENT: config,
      })
    })
  })
})
