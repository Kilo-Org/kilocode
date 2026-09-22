import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Npm } from "@opencode-ai/core/npm"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { Config } from "../../src/config/config"
import { mark } from "../../src/kilocode/skill/trust"
import { Plugin } from "../../src/plugin"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"

const plugin = pathToFileURL(path.join(import.meta.dir, "fixtures", "plugin-skill.ts")).href
const config = AppNodeBuilder.build(Config.node, [
  [Auth.node, AuthTest.empty],
  [Account.node, AccountTest.empty],
  [Npm.node, NpmTest.noop],
  [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
])
const plugins = AppNodeBuilder.build(Plugin.node, [
  [Config.node, config],
  [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
])
const skills = AppNodeBuilder.build(Skill.node, [[Config.node, config]])
const deps = Layer.mergeAll(config, plugins).pipe(Layer.provideMerge(config))
const layer = Layer.mergeAll(skills, deps).pipe(Layer.provideMerge(deps))
const it = testEffect(layer)

it.instance(
  "loads skills registered by a plugin config hook",
  () =>
    Effect.gen(function* () {
      yield* Plugin.Service.use((service) => service.init())
      const list = yield* Skill.Service.use((service) => service.all())

      expect(list.find((item) => item.name === "plugin-skill")).toMatchObject({
        description: "Registered by a plugin config hook.",
        content: expect.stringContaining("plugin payload"),
        trusted: true,
      })
    }),
  {
    config: { plugin: [plugin] },
    init: (dir) =>
      Effect.gen(function* () {
        const root = `${dir}-plugin-skills`
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(root, { recursive: true, force: true })))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(root, "example", "SKILL.md"),
            `---
name: plugin-skill
description: Registered by a plugin config hook.
---

# Plugin skill

{file:../payload.txt}
`,
          ),
        )
        yield* Effect.promise(() => Bun.write(path.join(root, "payload.txt"), "plugin payload"))
      }),
  },
)

it.instance(
  "keeps pre-existing skill paths untrusted after plugin initialization",
  () =>
    Effect.gen(function* () {
      const cfg = yield* Config.Service.use((service) => service.get())
      const origin = structuredClone(cfg.skill_path_origins?.["./skills"])
      expect(origin?.trusted).toBe(false)

      yield* Plugin.Service.use((service) => service.init())
      expect(cfg.skills?.paths).toHaveLength(2)
      expect(cfg.skill_path_origins?.["./skills"]).toEqual(origin)

      const list = yield* Skill.Service.use((service) => service.all())
      expect(list.find((item) => item.name === "configured-skill")).toMatchObject({
        description: "Configured by the project.",
        content: expect.stringContaining("untrusted skill"),
        trusted: false,
      })
    }),
  {
    config: { plugin: [plugin], skills: { paths: ["./skills"] } },
    init: (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "skills", "example", "SKILL.md"),
            `---
name: configured-skill
description: Configured by the project.
---

untrusted skill
`,
          ),
        )
      }),
  },
)

test("does not trust pre-existing paths without recorded origins", () => {
  const cfg: Config.Info = { skills: { paths: ["existing", "added"] } }

  mark(cfg, new Set(["existing"]))

  expect(cfg.skill_path_origins).toEqual({
    added: { trusted: true, source: "plugin config hook" },
  })
})
