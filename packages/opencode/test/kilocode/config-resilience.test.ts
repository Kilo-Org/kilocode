import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { provideTestInstance } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Flag } from "@opencode-ai/core/flag/flag"

const load = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
const warnings = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.warnings()))

afterEach(async () => {
  await disposeAllInstances()
  await AppRuntime.runPromise(Config.Service.use((svc) => svc.invalidate()))
})

describe("config resilience", () => {
  test("retains untrusted provenance for external markdown paths selected by project config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const project = path.join(dir, "project")
        const instruction = path.join(dir, "external.md")
        await Filesystem.write(
          path.join(project, "kilo.json"),
          JSON.stringify({ instructions: [instruction], skills: { paths: ["../external-skills"] } }),
        )
        await Filesystem.write(instruction, "external")
        await Filesystem.write(path.join(dir, "external-skills", "SKILL.md"), "external")
        return { project, instruction }
      },
    })

    await provideTestInstance({
      directory: tmp.extra.project,
      fn: async () => {
        const cfg = await load()
        expect(cfg.instruction_origins?.[tmp.extra.instruction]).toMatchObject({
          trusted: false,
          root: tmp.extra.project,
        })
        expect(cfg.skill_path_origins?.["../external-skills"]).toMatchObject({
          trusted: false,
          root: tmp.extra.project,
        })
      },
    })
  })

  test("skips project markdown that references environment or out-of-project files", async () => {
    const name = "KILO_CONFIG_MARKDOWN_PROJECT_SECRET"
    const prior = process.env[name]
    process.env[name] = "environment secret"
    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const project = path.join(dir, "project")
          const secret = path.join(dir, "secret.txt")
          const prompt = [`{file:${secret}}`, `{env:${name}}`].join("\n")
          await Filesystem.write(path.join(project, ".kilo", "agent", "unsafe.md"), prompt)
          await Filesystem.write(path.join(project, ".kilo", "command", "unsafe.md"), prompt)
          await Filesystem.write(secret, "file secret")
          return project
        },
      })

      await provideTestInstance({
        directory: tmp.extra,
        fn: async () => {
          const cfg = await load()
          const warns = await warnings()

          expect(cfg.agent?.unsafe).toBeUndefined()
          expect(cfg.command?.unsafe).toBeUndefined()
          expect(warns.filter((warning) => warning.path.endsWith("unsafe.md"))).toHaveLength(2)
        },
      })
    } finally {
      if (prior === undefined) delete process.env[name]
      else process.env[name] = prior
    }
  })

  test("skips project markdown symlinks that escape the project root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const project = path.join(dir, "project")
        const item = path.join(project, ".kilo", "agent", "unsafe.md")
        const secret = path.join(dir, "secret.md")
        await Filesystem.write(secret, "file secret")
        await fs.mkdir(path.dirname(item), { recursive: true })
        await fs.symlink(secret, item)
        return project
      },
    })

    await provideTestInstance({
      directory: tmp.extra,
      fn: async () => {
        const cfg = await load()
        const warns = await warnings()

        expect(cfg.agent?.unsafe).toBeUndefined()
        expect(warns.some((warning) => warning.path.endsWith("unsafe.md"))).toBe(true)
      },
    })
  })

  test.serial(
    "loads external directory symlinks explicitly allowed by global config without trusting tokens",
    async () => {
      const name = "KILO_EXTERNAL_MARKDOWN_SECRET"
      const env = process.env[name]
      const config = Flag.KILO_CONFIG
      process.env[name] = "environment secret"
      await using tmp = await tmpdir({
        init: async (dir) => {
          const project = path.join(dir, "project")
          const shared = path.join(dir, "shared")
          const agents = path.join(shared, "agents")
          const commands = path.join(shared, "commands")
          const secret = path.join(dir, "secret.txt")
          const escaped = path.join(dir, "escaped.md")
          const global = path.join(dir, "global.json")
          await Filesystem.write(path.join(agents, "shared.md"), "Shared agent prompt")
          await Filesystem.write(path.join(commands, "shared.md"), "Shared command template")
          await Filesystem.write(path.join(agents, "env.md"), `{env:${name}}`)
          await Filesystem.write(path.join(commands, "file.md"), `{file:${secret}}`)
          await Filesystem.write(secret, "file secret")
          await Filesystem.write(escaped, "Escaped agent prompt")
          await fs.symlink(escaped, path.join(agents, "escaped.md"))
          await fs.mkdir(path.join(project, ".kilo"), { recursive: true })
          const type = process.platform === "win32" ? "junction" : "dir"
          await fs.symlink(agents, path.join(project, ".kilo", "agents"), type)
          await fs.symlink(commands, path.join(project, ".kilo", "commands"), type)
          await Filesystem.write(
            global,
            JSON.stringify({
              permission: {
                markdown_source: {
                  [path.join(agents, "*")]: "allow",
                  [path.join(commands, "*")]: "allow",
                },
              },
            }),
          )
          return { project, global }
        },
      })
      Flag.KILO_CONFIG = tmp.extra.global

      try {
        await provideTestInstance({
          directory: tmp.extra.project,
          fn: async () => {
            const cfg = await load()
            const warns = await warnings()

            expect(cfg.agent?.shared).toMatchObject({ prompt: "Shared agent prompt" })
            expect(cfg.command?.shared).toMatchObject({ template: "Shared command template" })
            expect(cfg.agent?.env).toBeUndefined()
            expect(cfg.agent?.escaped).toBeUndefined()
            expect(cfg.command?.file).toBeUndefined()
            expect(
              warns.filter(
                (warning) =>
                  warning.path.endsWith("env.md") ||
                  warning.path.endsWith("escaped.md") ||
                  warning.path.endsWith("file.md"),
              ),
            ).toHaveLength(3)
          },
        })
      } finally {
        Flag.KILO_CONFIG = config
        if (env === undefined) delete process.env[name]
        else process.env[name] = env
      }
    },
  )

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()
        const warns = await warnings()

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

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const cfg = await load()
        const warns = await warnings()

        expect(cfg).toBeDefined()
        expect(warns.some((w) => w.path.includes("kilo.json") && w.message.includes("invalid"))).toBe(true)
      },
    })
  })

  test("returns empty warnings when config is valid", async () => {
    await using tmp = await tmpdir({
      config: { model: "test/model" },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await load()
        const warns = await warnings()

        expect(warns).toEqual([])
      },
    })
  })
})
