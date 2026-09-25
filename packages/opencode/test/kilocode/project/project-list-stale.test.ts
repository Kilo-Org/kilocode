import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import * as fs from "fs/promises"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Project } from "@/project/project"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const node = LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])
const it = testEffect(AppNodeBuilder.build(node))

describe("Project.list hides removed projects", () => {
  it.live("drops a project whose worktree directory no longer exists", () =>
    Effect.gen(function* () {
      const svc = yield* Project.Service
      const live = yield* tmpdirScoped({ git: true })
      const stale = yield* tmpdirScoped({ git: true })
      const kept = yield* svc.fromDirectory(live)
      const removed = yield* svc.fromDirectory(stale)

      yield* Effect.promise(() => fs.rm(stale, { recursive: true, force: true }))

      const ids = (yield* svc.list()).map((item) => item.id)

      expect(ids).toContain(kept.project.id)
      expect(ids).not.toContain(removed.project.id)
    }),
  )

  it.live("keeps a project whose worktree is gone while a sandbox still exists", () =>
    Effect.gen(function* () {
      const svc = yield* Project.Service
      const main = yield* tmpdirScoped({ git: true })
      const linked = yield* tmpdirScoped()
      const opened = yield* svc.fromDirectory(main)
      yield* svc.addSandbox(opened.project.id, linked)

      yield* Effect.promise(() => fs.rm(main, { recursive: true, force: true }))

      const ids = (yield* svc.list()).map((item) => item.id)

      expect(ids).toContain(opened.project.id)
    }),
  )

  it.live("drops a removed git checkout that resolves to the global id", () =>
    Effect.gen(function* () {
      const svc = yield* Project.Service
      const blank = yield* tmpdirScoped({
        init: (dir) =>
          Effect.promise(async () => {
            await $`git init`.cwd(dir).quiet()
          }),
      })
      const opened = yield* svc.fromDirectory(blank)
      expect(String(opened.project.id)).toBe("global")

      yield* Effect.promise(() => fs.rm(blank, { recursive: true, force: true }))

      const ids = (yield* svc.list()).map((item) => String(item.id))

      expect(ids).not.toContain("global")
    }),
  )
})
