import { expect } from "bun:test"
import * as nativeFs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { SnapshotCleanup } from "../src/agent-manager/snapshot"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, Global.node])))

const item = (base: string, project = "project", name = "worktree", directory = path.join(base, "project")) => ({
  data: path.join(base, "data"),
  project,
  directory,
  worktree: path.join(directory, ".kilo", "worktrees", name),
})

type Item = ReturnType<typeof item>

const repository = (input: Item, canonical = input.worktree) =>
  path.join(input.data, "snapshot", input.project, Hash.fast(canonical))

const repo = (input: Item, canonical?: string) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const dir = repository(input, canonical)
    yield* fs.ensureDir(path.join(dir, "objects", "pack")).pipe(Effect.orDie)
    yield* fs.ensureDir(path.join(dir, "lfs", "objects", "aa", "bb")).pipe(Effect.orDie)
    yield* fs.ensureDir(input.worktree).pipe(Effect.orDie)
    yield* fs.ensureDir(input.directory).pipe(Effect.orDie)
    yield* fs.writeWithDirs(path.join(dir, "objects", "pack", "pack-test.pack"), "pack").pipe(Effect.orDie)
    yield* fs.writeWithDirs(path.join(dir, "lfs", "objects", "aa", "bb", "object"), new Uint8Array([1, 2, 3])).pipe(Effect.orDie)
    return { ...input, dir }
  })

const remove = (input: Item) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return yield* SnapshotCleanup.remove({ ...input, fs })
  })

const exist = (file: string) => FSUtil.Service.use((fs) => fs.existsSafe(file))
const drop = (file: string) =>
  FSUtil.Service.use((fs) => fs.remove(file, { recursive: true, force: true }).pipe(Effect.orDie))
const write = (file: string, value: string | Uint8Array = "") =>
  FSUtil.Service.use((fs) => fs.writeWithDirs(file, value).pipe(Effect.orDie))
const link = (target: string, file: string) => Effect.promise(() => nativeFs.symlink(target, file))

it.effect("removes an explicitly deleted snapshot repository recursively", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "removed")
    const current = yield* repo(input)
    yield* drop(input.worktree)

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(current.dir)).toBe(false)
  }),
)

it.effect("leaves unrelated project entries untouched", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "retained")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const retained = path.join(path.dirname(current.dir), "keep.txt")
    yield* write(retained, "keep")

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(retained)).toBe(true)
  }),
)

it.effect("refuses to remove a live worktree", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "live")
    const current = yield* repo(input)

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(input.worktree)).toBe(true)
    expect(yield* exist(current.dir)).toBe(true)
  }),
)

it.effect("rejects paths outside the managed worktrees directory", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "outside")
    const outside = path.join(input.directory, ".kilo", "worktrees-evil", "outside")
    yield* write(path.join(outside, "sentinel"), "keep")

    const error = yield* remove({ ...input, worktree: outside }).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.effect("isolates sibling snapshot repositories", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
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

it.effect("isolates snapshot repositories by project", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
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

it.effect("finishes an interrupted quarantine without deleting unrelated directories", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "retry")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const quarantine = path.join(
      path.dirname(current.dir),
      `.${path.basename(current.dir)}.cleanup-${crypto.randomUUID()}`,
    )
    const unrelated = path.join(path.dirname(current.dir), ".other.cleanup-00000000-0000-0000-0000-000000000000")
    const fs = yield* FSUtil.Service
    yield* fs.rename(current.dir, quarantine).pipe(Effect.orDie)
    yield* write(path.join(unrelated, "keep"), "keep")

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(quarantine)).toBe(false)
    expect(yield* exist(unrelated)).toBe(true)
    expect(yield* remove(input)).toBe(false)
  }),
)

it.effect("rejects a symlinked cleanup quarantine during a retry", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
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

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(path.join(outside, "keep"))).toBe(true)
  }),
)

it.effect("removes an absent snapshot repository idempotently", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "project", "absent")

    expect(yield* remove(input)).toBe(false)
    expect(yield* remove(input)).toBe(false)
  }),
)

for (const stored of [false, true]) {
  it.effect(`cleans ${stored ? "existing" : "absent"} checkpoints without accessing workspace ancestors`, () =>
    Effect.gen(function* () {
      const { path: base } = yield* tmpdirScoped()
      const input = item(path.join(base, "allowed"))
      const current = stored ? yield* repo(input) : undefined
      const fs = yield* FSUtil.Service
      yield* fs.ensureDir(path.dirname(input.worktree)).pipe(Effect.orDie)
      yield* drop(input.worktree)
      const denied = Effect.die(new Error("Workspace ancestor access denied"))

      const removed = yield* SnapshotCleanup.remove({
        ...input,
        fs: {
          ...fs,
          realPath: (target) => (target === base ? denied : fs.realPath(target)),
          stat: (target) => (target === base ? denied : fs.stat(target)),
          readDirectoryEntries: (target) => (target === base ? denied : fs.readDirectoryEntries(target)),
        },
      })
      expect(removed).toBe(stored)
      if (current) expect(yield* exist(current.dir)).toBe(false)
      expect(yield* exist(input.directory)).toBe(true)
    }),
  )
}

it.effect("removes safely when the snapshot root, project, or repository is missing", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "missing-levels", "missing-levels")
    const fs = yield* FSUtil.Service

    expect(yield* remove(input)).toBe(false)
    yield* fs.ensureDir(path.join(input.data, "snapshot")).pipe(Effect.orDie)
    expect(yield* remove(input)).toBe(false)
    yield* fs.ensureDir(path.join(input.data, "snapshot", input.project)).pipe(Effect.orDie)
    expect(yield* remove(input)).toBe(false)
  }),
)

it.effect("rejects a symlinked snapshot root", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const outside = path.join(base, "outside-root")
    const input = item(base, "root-link", "root-link")
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* FSUtil.Service.use((fs) => fs.ensureDir(input.data).pipe(Effect.orDie))
    yield* link(outside, path.join(input.data, "snapshot"))

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.effect("rejects symlinks in ancestors of the workspace and snapshot root", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const ancestor = path.join(base, "ancestor")
    const input = item(ancestor)
    const current = yield* repo(input)
    yield* drop(input.worktree)
    const fs = yield* FSUtil.Service
    const outside = path.join(base, "outside")
    yield* fs.rename(ancestor, outside).pipe(Effect.orDie)
    yield* link(outside, ancestor)

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(current.dir)).toBe(true)
  }),
)

it.effect("rejects a symlinked snapshot project", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const outside = path.join(base, "outside-project")
    const input = item(base, "project-link", "project-link")
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* write(path.join(input.data, "snapshot", "placeholder"), "")
    yield* link(outside, path.join(input.data, "snapshot", input.project))

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.effect("rejects a symlinked snapshot repository", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const outside = path.join(base, "outside-repository")
    const input = item(base, "repository-link", "repository-link")
    const current = yield* repo(input)
    yield* drop(input.worktree)
    yield* write(path.join(outside, "sentinel"), "keep")
    yield* drop(current.dir)
    yield* link(outside, current.dir)

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
  }),
)

it.effect("rejects a dangling managed worktree symlink", () =>
  Effect.gen(function* () {
    const { path: base } = yield* tmpdirScoped()
    const input = item(base, "dangling-worktree", "dangling-worktree")
    yield* repo(input)
    yield* drop(input.worktree)
    yield* write(path.join(base, "outside"), "keep")
    yield* link(path.join(base, "missing"), input.worktree)

    const error = yield* remove(input).pipe(Effect.flip)
    expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    const entries = yield* FSUtil.Service.use((fs) => fs.readDirectoryEntries(path.dirname(input.worktree)))
    expect(entries.find((entry) => entry.name === path.basename(input.worktree))?.type).toBe("symlink")
    expect(yield* exist(path.join(base, "outside"))).toBe(true)
  }),
)

for (const name of [".kilo", "worktrees"]) {
  it.effect(`rejects a symlinked managed ${name} directory`, () =>
    Effect.gen(function* () {
      const { path: base } = yield* tmpdirScoped()
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

      const error = yield* remove(input).pipe(Effect.flip)
      expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
      expect(yield* exist(path.join(outside, "sentinel"))).toBe(true)
    }),
  )
}

it.effect("accepts a macOS temporary-directory alias", () =>
  Effect.gen(function* () {
    if (process.platform !== "darwin") return
    const { path: canonicalBase } = yield* tmpdirScoped()
    const aliasBase = canonicalBase.replace(/^\/private/, "")
    const input = item(aliasBase, "macos-alias", "macos-alias")
    const canonicalWorktree = path.join(canonicalBase, "project", ".kilo", "worktrees", "macos-alias")
    const current = yield* repo(input, canonicalWorktree)
    yield* drop(input.worktree)

    expect(yield* remove(input)).toBe(true)
    expect(yield* exist(current.dir)).toBe(false)
  }),
)

for (const project of ["", ".", "..", "project/name", "/tmp/project", "project\\name"]) {
  it.effect(`rejects malformed project component ${JSON.stringify(project)}`, () =>
    Effect.gen(function* () {
      const { path: base } = yield* tmpdirScoped()
      const input = item(base, project, "malformed-project")

      const error = yield* remove(input).pipe(Effect.flip)
      expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    }),
  )
}

for (const name of ["", ".", "..", "worktree/name", "worktree\\name"]) {
  it.effect(`rejects malformed worktree component ${JSON.stringify(name)}`, () =>
    Effect.gen(function* () {
      const { path: base } = yield* tmpdirScoped()
      const input = item(base, "valid-project", name)

      const error = yield* remove(input).pipe(Effect.flip)
      expect(error._tag).toBe("AgentManager.InvalidWorktreeError")
    }),
  )
}
