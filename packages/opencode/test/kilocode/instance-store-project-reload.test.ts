import { describe, expect } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Exit } from "effect"
import { reloadProject } from "@/kilocode/project/reload"
import type { InstanceContext } from "@/project/instance-context"
import type { Project } from "@/project/project"
import { InstanceStore } from "@/project/instance-store"
import { testEffect } from "../lib/effect"
import { testInstanceStoreLayer } from "../fixture/fixture"

const it = testEffect(testInstanceStoreLayer)

const temporary = Effect.acquireRelease(
  Effect.promise(async () => await realpath(await mkdtemp(join(tmpdir(), "opencode-test-")))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
)

const makeProject = (id: string, worktree: string): Project.Info => ({
  id: ProjectV2.ID.make(id),
  worktree,
  sandboxes: [],
  time: { created: 0, updated: 0 },
})

const context = (dir: string, id: string): InstanceContext => ({
  directory: dir,
  worktree: dir,
  project: makeProject(id, dir),
})

const stub = (contexts: InstanceContext[], reload: InstanceStore.Interface["reload"]) =>
  ({ list: () => Effect.succeed(contexts), reload }) as unknown as InstanceStore.Interface

describe("reloadProject", () => {
  it.live("reloads every loaded instance of the project and leaves other projects alone", () =>
    Effect.gen(function* () {
      const dirA = yield* temporary
      const dirB = yield* temporary
      const dirC = yield* temporary
      const store = yield* InstanceStore.Service

      const a = yield* store.load({ directory: dirA, worktree: dirA, project: makeProject("proj_reload_shared", dirA) })
      const b = yield* store.load({ directory: dirB, worktree: dirB, project: makeProject("proj_reload_shared", dirB) })
      const c = yield* store.load({ directory: dirC, worktree: dirC, project: makeProject("proj_reload_other", dirC) })

      yield* reloadProject(store, "proj_reload_shared", dirA)

      expect(yield* store.load({ directory: dirA })).not.toBe(a)
      expect(yield* store.load({ directory: dirB })).not.toBe(b)
      expect(yield* store.load({ directory: dirC })).toBe(c)
    }),
  )

  it.live("is a no-op for a project with no loaded instances", () =>
    Effect.gen(function* () {
      const dir = yield* temporary
      const store = yield* InstanceStore.Service

      const loaded = yield* store.load({ directory: dir, worktree: dir, project: makeProject("proj_reload_solo", dir) })

      yield* reloadProject(store, "proj_reload_missing", dir)

      expect(yield* store.load({ directory: dir })).toBe(loaded)
    }),
  )

  it.live("propagates a failure for the request directory", () =>
    Effect.gen(function* () {
      const dirA = "/tmp/reload-request-a"
      const dirB = "/tmp/reload-request-b"
      const contexts = [context(dirA, "proj_reload_stub"), context(dirB, "proj_reload_stub")]
      const store = stub(contexts, (input) =>
        input.directory === dirA ? Effect.die(new Error("request reload failed")) : Effect.succeed(contexts[1]!),
      )

      const exit = yield* reloadProject(store, "proj_reload_stub", dirA).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live("skips a failure for a sibling directory", () =>
    Effect.gen(function* () {
      const dirA = "/tmp/reload-sibling-a"
      const dirB = "/tmp/reload-sibling-b"
      const contexts = [context(dirA, "proj_reload_stub"), context(dirB, "proj_reload_stub")]
      const store = stub(contexts, (input) =>
        input.directory === dirB ? Effect.die(new Error("sibling reload failed")) : Effect.succeed(contexts[0]!),
      )

      const exit = yield* reloadProject(store, "proj_reload_stub", dirA).pipe(Effect.exit)

      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )
})
