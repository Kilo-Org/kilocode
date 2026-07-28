import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Config } from "../../src/config/config"
import { Git } from "../../src/git"
import { provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const skills = (home: string) =>
  Skill.layer.pipe(
    Layer.provide(Git.defaultLayer),
    Layer.provide(Discovery.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Global.layerWith({ home })),
    Layer.provide(RuntimeFlags.layer({ disableExternalSkills: false, disableClaudeCodeSkills: false })),
  )

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, testInstanceStoreLayer))

describe("non-Git global skills", () => {
  it.live("loads global skills when the project is below the home directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = path.join(tmp.path, "projects", "plain")
      const roots = [".agents", ".claude"] as const

      yield* Effect.promise(async () => {
        await fs.mkdir(project, { recursive: true })
        await Promise.all(
          roots.map(async (root) => {
            const name = `${root.slice(1)}-global`
            const dir = path.join(tmp.path, root, "skills", name)
            await fs.mkdir(dir, { recursive: true })
            await Bun.write(
              path.join(dir, "SKILL.md"),
              `---
name: ${name}
description: Global ${root} skill.
---

# Global skill
`,
            )
          }),
        )
      })

      yield* Effect.gen(function* () {
        const skill = yield* Skill.Service
        const list = yield* skill.all()

        for (const root of roots) {
          const name = `${root.slice(1)}-global`
          expect(list.find((item) => item.name === name)?.location).toBe(
            path.join(tmp.path, root, "skills", name, "SKILL.md"),
          )
        }
      }).pipe(Effect.provide(skills(tmp.path)), provideInstance(project))
    }),
  )
})
