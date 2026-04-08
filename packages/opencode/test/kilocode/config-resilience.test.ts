import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
})

describe("config resilience", () => {
  test("skips invalid agent markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "agent", "skip.md"),
          `---
mode: "banana"
---
Broken agent prompt`,
        )
        await Filesystem.write(
          path.join(dir, ".kilo", "agent", "keep.md"),
          `---
model: test/model
---
Valid agent prompt`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()

        expect(cfg.agent?.["skip"]).toBeUndefined()
        expect(cfg.agent?.["keep"]).toMatchObject({
          name: "keep",
          model: "test/model",
          prompt: "Valid agent prompt",
        })
      },
    })
  })

  test("reports a warning for invalid agent markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "agent", "skip.md"),
          `---
mode: "banana"
---
Broken agent prompt`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        const warns = await Config.warnings()

        expect(warns.some((w) => w.path.includes("skip.md") && w.message.includes("mode"))).toBe(true)
      },
    })
  })

  test("skips invalid command markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "command", "skip.md"),
          `---
subtask: "banana"
---
Broken command template`,
        )
        await Filesystem.write(
          path.join(dir, ".kilo", "command", "keep.md"),
          `---
description: Valid command
---
Valid command template`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()

        expect(cfg.command?.["skip"]).toBeUndefined()
        expect(cfg.command?.["keep"]).toEqual({
          description: "Valid command",
          template: "Valid command template",
        })
      },
    })
  })

  test("reports a warning for invalid command markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "command", "skip.md"),
          `---
subtask: "banana"
---
Broken command template`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        const warns = await Config.warnings()

        expect(warns.some((w) => w.path.includes("skip.md") && w.message.includes("subtask"))).toBe(true)
      },
    })
  })

  test("collects warnings for invalid agent markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "agent", "broken.md"),
          `---
mode: "banana"
---
Broken agent`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        const warns = await Config.warnings()

        expect(warns.some((w) => w.path.includes("broken.md") && w.message.includes("invalid"))).toBe(true)
      },
    })
  })

  test("collects warnings for invalid command markdown configs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".kilo", "command", "broken.md"),
          `---
subtask: "banana"
---
Broken command`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        const warns = await Config.warnings()

        expect(warns.some((w) => w.path.includes("broken.md") && w.message.includes("invalid"))).toBe(true)
      },
    })
  })

  test("collects warnings for invalid JSON in .kilo directory config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, ".kilo", "kilo.json"), "{ not valid json !!!")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()
        const warns = await Config.warnings()

        // Config loading should not crash
        expect(cfg).toBeDefined()
        // Warning should reference the bad file
        expect(warns.some((w) => w.path.includes("kilo.json") && w.message.includes("not valid JSON"))).toBe(true)
      },
    })
  })

  test("collects warnings for invalid schema in .kilo directory config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, ".kilo", "kilo.json"), JSON.stringify({ unknownField: true }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()
        const warns = await Config.warnings()

        expect(cfg).toBeDefined()
        expect(warns.some((w) => w.path.includes("kilo.json") && w.message.includes("invalid"))).toBe(true)
      },
    })
  })

  test("returns empty warnings when config is valid", async () => {
    await using tmp = await tmpdir({
      config: { model: "test/model" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        const warns = await Config.warnings()

        expect(warns).toEqual([])
      },
    })
  })
})
