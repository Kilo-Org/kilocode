// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { ConfigValidation } from "../../src/kilocode/config-validation"
import { Config } from "../../src/config/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Filesystem } from "../../src/util/filesystem"
import { disposeAllInstances, provideTestInstance, TestInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

afterEach(async () => {
  await disposeAllInstances()
})

const check = (filepath: string) => ConfigValidation.check(filepath)

describe("ConfigValidation.check", () => {
  test("returns empty string for non-config files", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "src", "index.ts")
    await Filesystem.write(filepath, "export const x = 1")

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
    })
    expect(result).toBe("")
  })

  test("validates valid JSONC config", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "kilo.json")
    await Filesystem.write(filepath, JSON.stringify({ model: "anthropic/claude-sonnet-4-20250514" }))

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("validated successfully")
  })

  test("reports JSONC syntax errors", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "kilo.json")
    await Filesystem.write(filepath, '{ "model": "test/model" "extra": true }')

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
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

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
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

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
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

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
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

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
    })
    expect(result).toContain("config_validation")
    expect(result).toContain("validated successfully")
  })

  test("skips AGENTS.md (root md file not in config subdir)", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "AGENTS.md")
    await Filesystem.write(filepath, "# Project agents")

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
    })
    expect(result).toBe("")
  })

  test("skips plan files (excluded subdir)", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, ".kilo", "plans", "plan.md")
    await Filesystem.write(filepath, "# Plan")

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: () => check(filepath),
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

    const result = await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        // Force config load to populate warnings
        await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
        return check(filepath)
      },
    })
    expect(result).toContain("Pre-existing config issues")
    expect(result).toContain("broken.md")
    expect(result).toContain("Post-edit validation")
  })

  // write/edit/apply_patch call check() via Effect.promise, which drops the
  // Effect fiber after the first await inside check. Reproduce that path.
  async function probe(dir: string, name: string, body: string) {
    const filepath = path.join(dir, ".kilo", "command", name)
    await Filesystem.write(filepath, body)
    return filepath
  }

  it.instance(
    "accepts a command file with no frontmatter via Effect.promise",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = yield* Effect.promise(() => probe(test.directory, "probe.md", "just a body, no frontmatter\n"))
        const result = yield* Effect.promise(() => check(filepath))
        expect(result).not.toContain("Failed to parse frontmatter")
        expect(result).not.toContain("No context found for instance")
        expect(result).toContain("validated successfully")
      }),
    { git: true },
  )

  it.instance(
    "accepts a command file with valid frontmatter via Effect.promise",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = yield* Effect.promise(() =>
          probe(
            test.directory,
            "probe.md",
            `---
description: probe
---
probe
`,
          ),
        )
        const result = yield* Effect.promise(() => check(filepath))
        expect(result).not.toContain("Failed to parse frontmatter")
        expect(result).not.toContain("No context found for instance")
        expect(result).toContain("validated successfully")
      }),
    { git: true },
  )
})
