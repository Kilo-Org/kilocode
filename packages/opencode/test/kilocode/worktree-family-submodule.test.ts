import { $ } from "bun"
import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Git } from "../../src/git"
import { WorktreeFamily } from "../../src/kilocode/worktree-family"
import { Project } from "../../src/project/project"
import * as Log from "@opencode-ai/core/util/log"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const it = testEffect(
  Layer.mergeAll(Project.defaultLayer, Git.defaultLayer, CrossSpawnSpawner.defaultLayer, testInstanceStoreLayer),
)

describe("WorktreeFamily.list — git submodule", () => {
  it.live("returns the submodule's working tree, not its gitdir", () =>
    Effect.gen(function* () {
      const parent = yield* tmpdirScoped({ git: true })
      const child = yield* tmpdirScoped({ git: true })

      // `protocol.file.allow=always` so the local clone is permitted, then commit
      // the .gitmodules entry so the submodule is part of the parent's history.
      yield* Effect.promise(() => $`git -c protocol.file.allow=always submodule add ${child} sub`.cwd(parent).quiet())
      yield* Effect.promise(() => $`git commit -m "add submodule"`.cwd(parent).quiet())

      const submodule = path.join(parent, "sub")
      const real = yield* Effect.promise(() => fs.realpath(submodule))

      const dirs = yield* provideInstance(submodule)(WorktreeFamily.list())
      // `git worktree list --porcelain` from inside a submodule reports the
      // gitdir (`<parent>/.git/modules/sub`) as the worktree, so without the
      // submodule guard the actual working tree is missing.
      expect(dirs).toContain(real)
    }),
  )
})
