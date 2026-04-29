// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ConfigValidation } from "../../src/kilocode/config-validation"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config"
import { Filesystem } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ConfigValidation.check", () => {
  test("returns empty string for non-config files", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "src", "index.ts")
    await Filesystem.write(filepath, "export const x = 1")

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toBe("")
  })

  test("validates valid JSONC config", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "kilo.json")
    await Filesystem.write(filepath, JSON.stringify({ model: "anthropic/claude-sonnet-4-20250514" }))

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("validated successfully")
  })

  test("reports JSONC syntax errors", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "kilo.json")
    await Filesystem.write(filepath, '{ "model": "test/model" "extra": true }')

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("ERROR")
    expect(result).toContain("not valid JSON(C)")
  })

  test("reports schema validation errors for unknown fields", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "kilo.json")
    // Config.Info uses .strict() so unknown fields produce errors
    await Filesystem.write(filepath, JSON.stringify({ notAField: true }))

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("WARNING")
    expect(result).toContain("invalid")
  })

  test("validates valid markdown command", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, ".kilo", "command", "test-cmd.md")
    await Filesystem.write(
      filepath,
      `---
description: A test command
---
Do something useful`,
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("validated successfully")
  })

  test("reports schema error for command with invalid field types", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, ".kilo", "command", "bad.md")
    // agent expects string but gets number — schema validation fails
    await Filesystem.write(
      filepath,
      `---
agent: 123
subtask: "not-a-boolean"
---
Do something`,
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("WARNING")
    expect(result).toContain("invalid")
  })

  test("validates valid markdown agent", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, ".kilo", "agent", "helper.md")
    await Filesystem.write(
      filepath,
      `---
model: anthropic/claude-sonnet-4-20250514
description: A helper agent
---
You are a helpful agent.`,
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("validated successfully")
  })

  test("skips AGENTS.md (root md file not in config subdir)", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "AGENTS.md")
    await Filesystem.write(filepath, "# Project agents")

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toBe("")
  })

  test("skips plan files (excluded subdir)", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, ".kilo", "plans", "plan.md")
    await Filesystem.write(filepath, "# Plan")

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => ConfigValidation.check(filepath),
    })
    expect(result).toBe("")
  })

  test("includes pre-existing warnings when present", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create a broken agent config that produces a warning at session start
        await Filesystem.write(
          path.join(dir, ".kilo", "agent", "broken.md"),
          `---
mode: "banana"
---
Broken agent`,
        )
      },
    })

    const filepath = path.join(tmp.path, "kilo.json")
    await Filesystem.write(filepath, JSON.stringify({ model: "anthropic/claude-sonnet-4-20250514" }))

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Force config load to populate warnings
        await Config.get()
        return ConfigValidation.check(filepath)
      },
    })
    expect(result).toContain("Pre-existing config issues")
    expect(result).toContain("broken.md")
    expect(result).toContain("Post-edit validation")
  })
})
