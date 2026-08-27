import { expect } from "bun:test"
import * as nativeFs from "fs/promises"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "../../src/session/schema"
import { KiloSnapshotCleanup } from "../../src/kilocode/snapshot/cleanup"
import { tmpdirScoped, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import { eq } from "drizzle-orm"

const env = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([FSUtil.node, AppProcess.node, EffectFlock.node, Database.node, CrossSpawnSpawner.node]),
  ),
  testInstanceStoreLayer,
)
const it = testEffect(env)

const git = (args: string[], opts?: { cwd?: string; env?: Record<string, string> }) =>
  Effect.gen(function* () {
    const app = yield* AppProcess.Service
    const result = yield* app.run(ChildProcess.make("git", args, { cwd: opts?.cwd, env: opts?.env, extendEnv: true }), {
      maxOutputBytes: 8192,
      maxErrorBytes: 8192,
    })
    if (result.exitCode !== 0) {
      return yield* Effect.die(new Error(`${result.command}: ${result.stderr.toString("utf8")}`))
    }
    return result
  })

const write = (file: string, value: string | Uint8Array = "") =>
  FSUtil.Service.use((fs) => fs.writeWithDirs(file, value).pipe(Effect.orDie))

const exist = (file: string) => FSUtil.Service.use((fs) => fs.existsSafe(file))

const drop = (file: string) =>
  FSUtil.Service.use((fs) => fs.remove(file, { recursive: true, force: true }).pipe(Effect.orDie))

const link = (target: string, file: string) => Effect.promise(() => nativeFs.symlink(target, file))

const tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const item = (base: string, project = "project", name = "worktree", directory = path.join(base, "project")) => ({
  root: path.join(base, "snapshots"),
  project,
  directory,
  worktree: path.join(directory, ".kilo", "worktrees", name),
})

const repo = (input: ReturnType<typeof item>) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const dir = path.join(input.root, input.project, Hash.fast(input.worktree))
    yield* fs.ensureDir(dir).pipe(Effect.orDie)
    yield* fs.ensureDir(input.worktree).pipe(Effect.orDie)
    yield* fs.ensureDir(input.directory).pipe(Effect.orDie)
    yield* git(["init"], { cwd: input.directory, env: { GIT_DIR: dir, GIT_WORK_TREE: input.worktree } })
    yield* git(["config", "user.email", "test@opencode.test"], { cwd: input.directory, env: { GIT_DIR: dir } })
    yield* git(["config", "user.name", "Test"], { cwd: input.directory, env: { GIT_DIR: dir } })
    const commit = yield* git(["--git-dir", dir, "commit-tree", tree, "-m", "snapshot"], { cwd: input.directory })
    yield* git(["--git-dir", dir, "update-ref", "HEAD", commit.stdout.toString("utf8").trim()], {
      cwd: input.directory,
    })
    return { ...input, dir }
  })

const remove = (input: ReturnType<typeof item>) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service
    return yield* KiloSnapshotCleanup.remove({ ...input, fs, flock })
  })

it.live("removes an explicitly deleted snapshot repository recursively", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "removed")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const lfs = path.join(current.dir, "lfs", "objects", "aa", "bb", "object")
    yield* write(lfs, new Uint8Array([1, 2, 3]))
    yield* write(path.join(current.dir, "objects", "pack", "pack-test.pack"), "pack")

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(current.dir)).toBe(false)
    expect(yield* exist(lfs)).toBe(false)
  }),
)

it.live("leaves retained session history untouched", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "retained")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const project = ProjectV2.ID.make(`proj_cleanup_${crypto.randomUUID()}`)
    const archived = SessionID.descending(`ses_cleanup_archived_${crypto.randomUUID()}`)
    const active = SessionID.descending(`ses_cleanup_active_${crypto.randomUUID()}`)
    const now = Date.now()
    const { db } = yield* Database.Service

    yield* db
      .insert(ProjectTable)
      .values({
        id: project,
        worktree: AbsolutePath.make(input.directory),
        vcs: "git",
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values([
        {
          id: archived,
          project_id: project,
          slug: "cleanup-archived",
          directory: input.worktree,
          title: "archived",
          version: "test",
          time_created: now,
          time_updated: now,
          time_archived: now,
        },
        {
          id: active,
          project_id: project,
          slug: "cleanup-active",
          directory: input.worktree,
          title: "active",
          version: "test",
          time_created: now,
          time_updated: now,
        },
      ])
      .run()
      .pipe(Effect.orDie)

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(current.dir)).toBe(false)
    const rows = yield* db
      .select({ id: SessionTable.id, directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, project))
      .all()
      .pipe(Effect.orDie)
    expect(rows).toEqual([
      { id: archived, directory: input.worktree },
      { id: active, directory: input.worktree },
    ])
  }),
)

it.live("refuses to remove a live worktree", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "live")
    const current = yield* repo(input)

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(input.worktree)).toBe(true)
    expect(yield* exist(current.dir)).toBe(true)
  }),
)

it.live("rejects paths outside the managed worktrees directory", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "outside")
    const outside = path.join(input.directory, ".kilo", "worktrees-evil", "outside")
    yield* write(path.join(outside, "sentinel"), "keep")

    expect(Exit.isFailure(yield* remove({ ...input, worktree: outside }).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.live("isolates sibling snapshot repositories", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const first = item(base, "project", "first")
    const second = item(base, "project", "second")
    const one = yield* repo(first)
    const two = yield* repo(second)
    yield* drop(first.worktree)
    yield* drop(second.worktree)

    expect(yield* remove(first)).toBe(true)
    expect(yield* exist(one.dir)).toBe(false)
    expect(yield* exist(two.dir)).toBe(true)
  }),
)

it.live("isolates snapshot repositories by project", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const first = item(base, "project-one", "shared")
    const second = item(base, "project-two", "shared")
    const one = yield* repo(first)
    const two = yield* repo(second)
    yield* drop(first.worktree)

    expect(yield* remove(first)).toBe(true)
    expect(yield* exist(one.dir)).toBe(false)
    expect(yield* exist(two.dir)).toBe(true)
  }),
)

it.live("finishes an interrupted quarantine without deleting unrelated directories", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "retry")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const quarantine = path.join(
      path.dirname(current.dir),
      `.${path.basename(current.dir)}.cleanup-${crypto.randomUUID()}`,
    )
    const unrelated = path.join(path.dirname(current.dir), ".other.cleanup-00000000-0000-0000-0000-000000000000")
    const fs = yield* FSUtil.Service
    yield* fs.rename(current.dir, quarantine)
    yield* write(path.join(unrelated, "keep"), "keep")

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(quarantine)).toBe(false)
    expect(yield* exist(unrelated)).toBe(true)
    expect(yield* remove(input)).toBe(true)
  }),
)

it.live("preserves a pending quarantine and completes cleanup after materialization", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "retry-pending")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const quarantine = path.join(
      path.dirname(current.dir),
      `.${path.basename(current.dir)}.cleanup-${crypto.randomUUID()}`,
    )
    const fs = yield* FSUtil.Service
    yield* fs.rename(current.dir, quarantine)
    const marker = path.join(quarantine, "seed.index")
    yield* write(marker, "pending")

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(quarantine)).toBe(true)
    yield* drop(marker)
    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(quarantine)).toBe(false)
  }),
)

it.live("rejects a symlinked cleanup quarantine during a retry", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "retry-symlink")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    yield* drop(current.dir)
    const outside = path.join(base, "outside-quarantine")
    yield* write(path.join(outside, "keep"), "keep")
    const quarantine = path.join(
      path.dirname(current.dir),
      `.${path.basename(current.dir)}.cleanup-${crypto.randomUUID()}`,
    )
    yield* link(outside, quarantine)

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(path.join(outside, "keep"))).toBe(true)
  }),
)

it.live("removes an absent snapshot repository idempotently", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "absent")

    expect(yield* remove(input)).toBe(true)
    expect(yield* remove(input)).toBe(true)
  }),
)

it.live("removes safely when the snapshot root, project, or repository is missing", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "missing-levels", "missing-levels")
    const fs = yield* FSUtil.Service

    expect(yield* remove(input)).toBe(true)
    yield* fs.ensureDir(input.root).pipe(Effect.orDie)
    expect(yield* remove(input)).toBe(true)
    yield* fs.ensureDir(path.join(input.root, input.project)).pipe(Effect.orDie)
    expect(yield* remove(input)).toBe(true)
  }),
)

it.live("waits for the snapshot repository lock", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "locked")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const flock = yield* EffectFlock.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const held = yield* flock
      .withLock(
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        }),
        `snapshot:${current.dir}`,
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const removing = yield* remove(input).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(yield* exist(current.dir)).toBe(true)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(held)
    yield* Fiber.join(removing)
    expect(yield* exist(current.dir)).toBe(false)
  }),
)

it.live("rechecks worktree absence after waiting for the lock", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "project", "locked-recheck")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const held = yield* flock
      .withLock(
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        }),
        `snapshot:${current.dir}`,
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const removing = yield* remove(input).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* fs.ensureDir(input.worktree).pipe(Effect.orDie)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(held)
    expect(Exit.isFailure(yield* Fiber.await(removing))).toBe(true)
    expect(yield* exist(current.dir)).toBe(true)
    yield* drop(input.worktree)
  }),
)

it.live("rejects a symlinked snapshot root", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const outside = path.join(base, "outside-root")
    const input = item(base, "root-link", "root-link")
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* link(outside, input.root)

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.live("rejects a symlinked snapshot project", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const outside = path.join(base, "outside-project")
    const input = item(base, "project-link", "project-link")
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* write(path.join(input.root, "placeholder"), "")
    yield* link(outside, path.join(input.root, input.project))

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.live("rejects a symlinked snapshot repository", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const outside = path.join(base, "outside-repository")
    const input = item(base, "repository-link", "repository-link")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* drop(current.dir)
    yield* link(outside, current.dir)

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.live("rejects a dangling managed worktree symlink", () =>
  Effect.gen(function* () {
    const base = yield* tmpdirScoped()
    const input = item(base, "dangling-worktree", "dangling-worktree")
    yield* repo(input)
    yield* drop(input.worktree)
    yield* write(path.join(base, "outside"), "keep")
    yield* link(path.join(base, "missing"), input.worktree)

    expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    const entries = yield* FSUtil.Service.use((fs) => fs.readDirectoryEntries(path.dirname(input.worktree)))
    expect(entries.find((entry) => entry.name === path.basename(input.worktree))?.type).toBe("symlink")
    expect(yield* exist(path.join(base, "outside"))).toBe(true)
  }),
)

for (const name of [".kilo", "worktrees"]) {
  it.live(`rejects a symlinked managed ${name} directory`, () =>
    Effect.gen(function* () {
      const base = yield* tmpdirScoped()
      const input = item(base, `managed-${name}`, `managed-${name}`)
      const outside = path.join(base, `outside-${name}`)
      yield* write(path.join(outside, "sentinel"), "keep")
      if (name === ".kilo") {
        yield* write(path.join(input.directory, "placeholder"), "")
        yield* link(outside, path.join(input.directory, name))
      } else {
        yield* write(path.join(input.directory, ".kilo", "placeholder"), "")
        yield* link(outside, path.join(input.directory, ".kilo", name))
      }

      expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
      expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
    }),
  )
}

for (const marker of [
  "objects/info/alternates",
  "objects/info/alternates.seed",
  "objects/info/alternates.materializing",
  "seed-objects/part",
  "seed.index",
  "seed.index.lock",
]) {
  it.live(`does not remove a repository with ${marker} pending`, () =>
    Effect.gen(function* () {
      const base = yield* tmpdirScoped()
      const input = item(base, "pending", marker.replaceAll("/", "-"))
      const current = yield* repo(input)
      yield* drop(input.worktree)
      yield* write(path.join(current.dir, marker), "pending")

      expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
      expect(yield* exist(current.dir)).toBe(true)
    }),
  )
}

it.live("accepts a macOS temporary-directory alias", () =>
  Effect.gen(function* () {
    if (process.platform !== "darwin") return
    const base = yield* tmpdirScoped()
    const aliasBase = base.replace(/^\/private/, "")
    const input = item(aliasBase, "macos-alias", "macos-alias")
    const current = yield* repo(input)
    yield* drop(input.worktree)

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(current.dir)).toBe(false)
  }),
)

for (const project of ["", ".", "..", "project/name", "/tmp/project", "project\\name"]) {
  it.live(`rejects malformed project component ${JSON.stringify(project)}`, () =>
    Effect.gen(function* () {
      const base = yield* tmpdirScoped()
      const input = item(base, project, "malformed-project")

      expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    }),
  )
}

for (const name of ["", ".", "..", "worktree/name", "worktree\\name"]) {
  it.live(`rejects malformed worktree component ${JSON.stringify(name)}`, () =>
    Effect.gen(function* () {
      const base = yield* tmpdirScoped()
      const input = item(base, "valid-project", name)

      expect(Exit.isFailure(yield* remove(input).pipe(Effect.exit))).toBe(true)
    }),
  )
}
