import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Git } from "../../src/git"
import { InstanceRef } from "../../src/effect/instance-ref"
import { WorktreeFamily } from "../../src/kilocode/worktree-family"
import { Project } from "../../src/project/project"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Project.defaultLayer, Git.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("WorktreeFamily.list", () => {
  it.live("returns recorded sandboxes when git worktree listing fails", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
      const root = yield* tmpdirScoped()
      const sandbox = yield* tmpdirScoped()
      const project = yield* Project.Service
      const info = (yield* project.fromDirectory(root)).project
      yield* project.addSandbox(info.id, sandbox)

      const dirs = yield* WorktreeFamily.list().pipe(
        Effect.provideService(InstanceRef, {
          directory: root,
          worktree: root,
          project: { ...info, vcs: "git" },
        }),
      )

      expect(dirs).toEqual([root, sandbox])
    }),
  )
})
