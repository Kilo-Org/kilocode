import { expect, test } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { KilocodePluginConfig } from "@/kilocode/plugin/config"
import { Plugin } from "@/plugin"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const flags = RuntimeFlags.layer({
  disableClaudeCodeSkills: true,
  disableDefaultPlugins: true,
  disableExternalSkills: true,
})
const config = Config.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(flags),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
  Layer.provide(FetchHttpClient.layer),
)
const plugin = Plugin.layer.pipe(Layer.provide(EventV2Bridge.defaultLayer), Layer.provide(flags))
const skill = Skill.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.layer({ disableClaudeCodeSkills: true, disableExternalSkills: true })),
)
const dependencies = Layer.mergeAll(config, plugin, skill).pipe(Layer.provideMerge(config))
const layer = Layer.mergeAll(dependencies, CrossSpawnSpawner.defaultLayer, testInstanceStoreLayer).pipe(
  Layer.provideMerge(dependencies),
)
const it = testEffect(layer)

const markdown = (name: string, body: string) => `---
name: ${name}
description: ${name} test skill
---
${body}
`

test("preserves config hook rejections after recording new skill paths", async () => {
  const cfg: Config.Info = { skills: { paths: [] } }
  const err = new Error("expected config hook failure")

  await expect(
    KilocodePluginConfig.apply(cfg, async () => {
      cfg.skills!.paths!.push("/plugin-skills")
      throw err
    }),
  ).rejects.toBe(err)
  expect(cfg.skill_path_origins?.["/plugin-skills"]).toMatchObject({
    source: "plugin config hook",
    trusted: true,
  })
  await expect(KilocodePluginConfig.apply({}, async () => Promise.reject(err))).rejects.toBe(err)
})

it.instance(
  "loads plugin skills while keeping configured external skills untrusted",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.dirname(dir)
          const pluginSkills = path.join(root, `${path.basename(dir)}-plugin-skills`)
          const projectSkills = path.join(root, `${path.basename(dir)}-project-skills`)
          const secretFile = path.join(root, `${path.basename(dir)}-secret.txt`)
          const plugin = path.join(dir, ".kilo", "plugin", "external-skills.ts")
          const secret = "project skill secret"
          const previous = process.env.KILO_EXTERNAL_SKILL_SECRET

          yield* Effect.addFinalizer(() =>
            Effect.promise(() =>
              Promise.all([
                fs.rm(pluginSkills, { force: true, recursive: true }),
                fs.rm(projectSkills, { force: true, recursive: true }),
                fs.rm(secretFile, { force: true }),
              ]),
            ),
          )
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previous === undefined) delete process.env.KILO_EXTERNAL_SKILL_SECRET
              else process.env.KILO_EXTERNAL_SKILL_SECRET = previous
            }),
          )
          yield* Effect.sync(() => {
            process.env.KILO_EXTERNAL_SKILL_SECRET = "plugin skill secret"
          })
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(path.join(pluginSkills, "plugin", "SKILL.md"), markdown("plugin", "{env:KILO_EXTERNAL_SKILL_SECRET}")),
              Bun.write(path.join(projectSkills, "plain", "SKILL.md"), markdown("plain", "safe project skill")),
              Bun.write(
                path.join(projectSkills, "unsafe-env", "SKILL.md"),
                markdown("unsafe-env", "{env:KILO_EXTERNAL_SKILL_SECRET}"),
              ),
              Bun.write(
                path.join(projectSkills, "unsafe-file", "SKILL.md"),
                markdown("unsafe-file", `{file:../../${path.basename(secretFile)}}`),
              ),
              Bun.write(secretFile, secret),
              Bun.write(
                plugin,
                `export default async () => ({
  config: async (cfg: { skills?: { paths?: string[] } }) => {
    cfg.skills ??= {}
    cfg.skills.paths = [...(cfg.skills.paths ?? []), ${JSON.stringify(pluginSkills)}]
  },
})
`,
              ),
              Bun.write(
                path.join(dir, "kilo.json"),
                JSON.stringify({
                  plugin: [pathToFileURL(plugin).href],
                  skills: { paths: [projectSkills] },
                }),
              ),
            ]),
          )

          yield* Plugin.Service.use((svc) => svc.init())

          const cfg = yield* Config.use.get()
          expect(cfg.skill_path_origins?.[pluginSkills]).toMatchObject({
            source: "plugin config hook",
            trusted: true,
          })
          expect(cfg.skill_path_origins?.[projectSkills]).toMatchObject({ root: dir, trusted: false })

          const skills = yield* Skill.Service
          const list = yield* skills.all()
          expect(list.find((item) => item.name === "plugin")?.content).toContain("plugin skill secret")
          expect(list.find((item) => item.name === "plain")?.content).toContain("safe project skill")
          expect(list.find((item) => item.name === "unsafe-env")).toBeUndefined()
          expect(list.find((item) => item.name === "unsafe-file")).toBeUndefined()
          expect(list.some((item) => item.content.includes(secret))).toBe(false)
        }),
      { git: true },
    ),
  30000,
)
