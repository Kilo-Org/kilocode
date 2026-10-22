import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { KilocodeConfig } from "../../src/kilocode/config/config"
import { IgnoreMigrator } from "../../src/kilocode/ignore-migrator"
import { McpMigrator } from "../../src/kilocode/mcp-migrator"
import { ModesMigrator } from "../../src/kilocode/modes-migrator"
import { RulesMigrator } from "../../src/kilocode/rules-migrator"
import { WorkflowsMigrator } from "../../src/kilocode/workflows-migrator"
import { tmpdir } from "../fixture/fixture"

const env = {
  flag: process.env.KILO_DISABLE_PROJECT_CONFIG,
  home: process.env.HOME,
  test: process.env.KILO_TEST_HOME,
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

afterEach(() => {
  restore("KILO_DISABLE_PROJECT_CONFIG", env.flag)
  restore("HOME", env.home)
  restore("KILO_TEST_HOME", env.test)
})

function home(dir: string) {
  process.env.HOME = dir
  process.env.KILO_TEST_HOME = dir
}

async function project(dir: string) {
  await Bun.write(
    path.join(dir, ".kilocode", "mcp.json"),
    JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"] } } }),
  )
  await Bun.write(
    path.join(dir, ".kilo", "mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "node", args: ["other.js"] } } }),
  )
  await Bun.write(path.join(dir, ".kilocode", "rules", "project.md"), "# Project rule")
  await Bun.write(path.join(dir, ".kilocode", "rules-code", "mode.md"), "# Mode rule")
  await Bun.write(path.join(dir, ".kilocoderules"), "# Legacy rule")
  await Bun.write(path.join(dir, ".kilocoderules-code"), "# Legacy mode rule")
  await Bun.write(
    path.join(dir, ".kilocodemodes"),
    `customModes:
  - slug: project-mode
    name: Project Mode
    roleDefinition: Project mode
    groups:
      - read
`,
  )
  await Bun.write(path.join(dir, ".kilocode", "workflows", "deploy.md"), "# Deploy\n\nDeploy steps")
  await Bun.write(path.join(dir, ".kilocodeignore"), "private/\n")
}

async function global(dir: string) {
  await Bun.write(path.join(dir, ".kilocode", "rules", "global.md"), "# Global rule")
  await Bun.write(path.join(dir, ".kilocode", "workflows", "release.md"), "# Release\n\nRelease steps")
  await Bun.write(
    path.join(dir, "settings", "custom_modes.yaml"),
    `customModes:
  - slug: global-mode
    name: Global Mode
    roleDefinition: Global mode
    groups:
      - read
`,
  )
}

describe("KILO_DISABLE_PROJECT_CONFIG with legacy Kilo Code files", () => {
  test("skips project MCP servers", async () => {
    await using tmp = await tmpdir({ init: project })
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const result = await McpMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

    expect(result.mcp).toEqual({})
  })

  test("skips project rules and keeps global rules", async () => {
    await using tmp = await tmpdir({ init: project })
    await using user = await tmpdir({ init: global })
    home(user.path)
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const result = await RulesMigrator.migrate({ projectDir: tmp.path })

    expect(result.instructions).toEqual([path.join(user.path, ".kilocode", "rules", "global.md")])
  })

  test("skips project modes and keeps global modes", async () => {
    await using tmp = await tmpdir({ init: project })
    await using user = await tmpdir({ init: global })
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const result = await ModesMigrator.migrate({
      projectDir: tmp.path,
      globalSettingsDir: path.join(user.path, "settings"),
      skipGlobalPaths: true,
    })

    expect(Object.keys(result.agents)).toEqual(["global-mode"])
  })

  test("skips project workflows and keeps global workflows", async () => {
    await using tmp = await tmpdir({ init: project })
    await using user = await tmpdir({ init: global })
    home(user.path)
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const workflows = await WorkflowsMigrator.discoverWorkflows(tmp.path)
    const result = await WorkflowsMigrator.migrate({ projectDir: tmp.path })

    expect(workflows.filter((item) => item.source === "project")).toEqual([])
    expect(result.commands["release"]).toBeDefined()
    expect(result.commands["deploy"]).toBeUndefined()
  })

  test("skips project ignore patterns", async () => {
    await using tmp = await tmpdir({ init: project })
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const result = await IgnoreMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

    expect(result.patternCount).toBe(0)
    expect(result.permission).toEqual({})
  })

  test("legacy config keeps only global sources", async () => {
    await using tmp = await tmpdir({ init: project })
    await using user = await tmpdir({ init: global })
    home(user.path)
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const result = await KilocodeConfig.loadLegacyConfigs({
      projectDir: tmp.path,
      merge: (target, source) => ({ ...target, ...source }),
    })

    expect(result.config.mcp).toBeUndefined()
    expect(result.config.permission).toBeUndefined()
    expect(result.config.agent?.["project-mode"]).toBeUndefined()
    expect(result.config.command?.["deploy"]).toBeUndefined()
    expect(result.config.command?.["release"]).toBeDefined()
    expect(result.config.instructions).toEqual([path.join(user.path, ".kilocode", "rules", "global.md")])
  })

  test("legacy config loads project sources when the flag is unset", async () => {
    await using tmp = await tmpdir({ init: project })
    await using user = await tmpdir({ init: global })
    home(user.path)
    delete process.env.KILO_DISABLE_PROJECT_CONFIG

    const result = await KilocodeConfig.loadLegacyConfigs({
      projectDir: tmp.path,
      merge: (target, source) => ({ ...target, ...source }),
    })

    expect(Object.keys(result.config.mcp ?? {}).sort()).toEqual(["local", "other"])
    expect(result.config.permission).toBeDefined()
    expect(result.config.agent?.["project-mode"]).toBeDefined()
    expect(result.config.command?.["deploy"]).toBeDefined()
    expect(result.config.command?.["release"]).toBeDefined()
    expect(result.config.instructions).toEqual(
      expect.arrayContaining([
        path.join(user.path, ".kilocode", "rules", "global.md"),
        path.join(tmp.path, ".kilocode", "rules", "project.md"),
        path.join(tmp.path, ".kilocoderules"),
      ]),
    )
  })
})
