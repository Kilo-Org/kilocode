import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { KiloRules } from "../../src/kilocode/rules"
import { Instance } from "../../src/project/instance"
import { Instruction } from "../../src/session/instruction"
import { tmpdir } from "../fixture/fixture"

const run = <A>(effect: Effect.Effect<A, any, Instruction.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Instruction.defaultLayer)))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("KiloRules.list", () => {
  test("lists loaded project, global, and configured rule files", async () => {
    const originalConfigDir = process.env["KILO_CONFIG_DIR"]
    delete process.env["KILO_CONFIG_DIR"]

    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir({
      config: { instructions: [".kilo/rules/style.md"] },
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Project Instructions")
        await fs.mkdir(path.join(dir, ".kilo", "rules"), { recursive: true })
        await Bun.write(path.join(dir, ".kilo", "rules", "style.md"), "# Style Rules")
      },
    })

    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const rules = yield* KiloRules.list()
              const paths = rules.map((rule) => rule.path)

              expect(rules).toContainEqual({
                path: path.join(projectTmp.path, ".kilo", "rules", "style.md"),
                name: "style.md",
              })
              expect(rules).toContainEqual({
                path: path.join(projectTmp.path, "AGENTS.md"),
                name: "AGENTS.md",
              })
              expect(rules).toContainEqual({
                path: path.join(globalTmp.path, "AGENTS.md"),
                name: "AGENTS.md",
              })
              expect(paths).toEqual(paths.toSorted())
            }),
          ),
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
      if (originalConfigDir === undefined) {
        delete process.env["KILO_CONFIG_DIR"]
      } else {
        process.env["KILO_CONFIG_DIR"] = originalConfigDir
      }
    }
  })
})
