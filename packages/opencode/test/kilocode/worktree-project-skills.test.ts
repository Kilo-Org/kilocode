import { $ } from "bun"
import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import path from "path"
import { Skill } from "../../src/skill"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(() => disposeAllInstances())

describe("worktree project skills", () => {
  it.live("discovers skills installed in the main repository", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir({ git: true })),
      (tmp) =>
        Effect.gen(function* () {
          const dir = path.join(tmp.path, ".kilo", "worktrees", "feature")
          yield* Effect.promise(() => $`git worktree add -b worktree-project-skills ${dir}`.cwd(tmp.path).quiet())
          yield* Effect.promise(() =>
            Bun.write(
              path.join(tmp.path, ".kilo", "skills", "project-skill", "SKILL.md"),
              `---
name: project-skill
description: A skill installed in the main repository.
---

# Project Skill
`,
            ),
          )

          const list = yield* provideInstance(dir)(
            Effect.gen(function* () {
              const skill = yield* Skill.Service
              return yield* skill.all()
            }),
          )

          expect(list.find((item) => item.name === "project-skill")?.location).toBe(
            path.join(tmp.path, ".kilo", "skills", "project-skill", "SKILL.md"),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
