import { $ } from "bun"
import { afterEach, describe, expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import path from "path"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Git } from "../../src/git"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Skill.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.layer({ disableExternalSkills: false, disableClaudeCodeSkills: false })),
  Layer.provide(EventV2Bridge.defaultLayer),
)
const it = testEffect(Layer.mergeAll(layer, CrossSpawnSpawner.defaultLayer, testInstanceStoreLayer))

afterEach(() => disposeAllInstances())

describe("worktree project skills", () => {
  it.live("uses primary skills as fallbacks and prefers worktree copies", () =>
    Effect.gen(function* () {
      const primary = yield* tmpdirScoped({ git: true })
      const dir = path.join(path.dirname(primary), `${path.basename(primary)}-feature`)
      const directory = path.join(dir, "packages", "app")
      const skills = [
        [".kilo", "kilo"],
        [".agents", "agents"],
        [".claude", "claude"],
      ] as const

      yield* Effect.promise(() =>
        Promise.all(
          skills.map(([root, name]) =>
            Bun.write(
              path.join(primary, root, "skills", `${name}-shared`, "SKILL.md"),
              `---
name: ${name}-shared
description: Shared primary skill.
---

# Primary
`,
            ),
          ),
        ),
      )
      yield* Effect.promise(() => $`git add .kilo .agents .claude`.cwd(primary).quiet())
      yield* Effect.promise(() => $`git commit -m skills`.cwd(primary).quiet())
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove --force ${dir}`.cwd(primary).quiet().nothrow()).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() => $`git worktree add -b worktree-project-skills ${dir}`.cwd(primary).quiet())

      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(path.join(directory, "placeholder"), ""),
          ...skills.flatMap(([root, name]) => [
            Bun.write(
              path.join(primary, root, "skills", `${name}-fallback`, "SKILL.md"),
              `---
name: ${name}-fallback
description: Primary-only fallback.
---

# Fallback
`,
            ),
            Bun.write(
              path.join(dir, root, "skills", `${name}-shared`, "SKILL.md"),
              `---
name: ${name}-shared
description: Worktree override.
---

# Worktree
`,
            ),
          ]),
          ...skills.slice(1).map(([root, name]) =>
            Bun.write(
              path.join(primary, "packages", root, "skills", `${name}-nested`, "SKILL.md"),
              `---
name: ${name}-nested
description: Nested primary-only fallback.
---

# Nested fallback
`,
            ),
          ),
          Bun.write(
            path.join(dir, "packages", ".agents", "skills", "agents-nested", "SKILL.md"),
            `---
name: agents-nested
description: Nested worktree override.
---

# Nested worktree
`,
          ),
        ]),
      )

      const list = yield* provideInstance(directory)(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          return yield* skill.all()
        }),
      )

      for (const [root, name] of skills) {
        expect(list.find((item) => item.name === `${name}-fallback`)?.location).toBe(
          path.join(primary, root, "skills", `${name}-fallback`, "SKILL.md"),
        )
        expect(list.find((item) => item.name === `${name}-shared`)?.location).toBe(
          path.join(dir, root, "skills", `${name}-shared`, "SKILL.md"),
        )
      }
      expect(list.find((item) => item.name === "claude-nested")?.location).toBe(
        path.join(primary, "packages", ".claude", "skills", "claude-nested", "SKILL.md"),
      )
      expect(list.find((item) => item.name === "agents-nested")?.location).toBe(
        path.join(dir, "packages", ".agents", "skills", "agents-nested", "SKILL.md"),
      )
    }),
  )
})
