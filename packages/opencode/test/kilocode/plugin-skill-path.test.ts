import { expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { Config } from "../../src/config/config"
import { Discovery } from "../../src/skill/discovery"
import { Env } from "../../src/env"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Git } from "../../src/git"
import { Plugin } from "../../src/plugin"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"

const plugin = pathToFileURL(path.join(import.meta.dir, "fixtures", "plugin-skill.ts")).href
const flags = RuntimeFlags.layer({ disableDefaultPlugins: true })
const config = Config.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(flags),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
  Layer.provide(FetchHttpClient.layer),
)
const events = EventV2Bridge.defaultLayer
const plugins = Plugin.layer.pipe(Layer.provide(events), Layer.provide(flags), Layer.provide(config))
const skills = Skill.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(config),
  Layer.provide(events),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(flags),
)
const layer = Layer.mergeAll(config, plugins, skills)
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
