import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { Effect } from "effect"
import path from "path"

export namespace KiloSnapshotCleanup {
  export interface Input {
    readonly root: string
    readonly project: string
    readonly directory: string
    readonly worktree: string
    readonly fs: FSUtil.Interface
    readonly flock: EffectFlock.Interface
  }

  type Checked = {
    readonly canonical: string
    readonly exists: boolean
    readonly type?: FSUtil.DirEntry["type"]
  }

  const normalized = (value: string) => {
    const result = path.normalize(value)
    return process.platform === "win32" ? result.toLowerCase() : result
  }

  const inside = (parent: string, child: string) => FSUtil.contains(normalized(parent), normalized(child))

  const component = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)

  const alias = (value: string, canonical: string) =>
    process.platform === "darwin" &&
    ((value === "/var" && canonical === "/private/var") || (value === "/tmp" && canonical === "/private/tmp"))

  const inspect = Effect.fnUntraced(function* (fs: FSUtil.Interface, target: string) {
    const root = path.parse(target).root
    const parts = path.relative(root, target).split(path.sep).filter(Boolean)
    let current = root
    let canonical = yield* fs
      .realPath(root)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(root)))

    for (const [index, name] of parts.entries()) {
      const info = yield* fs
        .stat(current)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!info) {
        return {
          canonical: path.join(canonical, ...parts.slice(index)),
          exists: false,
        } satisfies Checked
      }
      if (info.type !== "Directory") return yield* Effect.fail(new Error("trusted path parent is not a directory"))

      const entries = yield* fs.readDirectoryEntries(current)
      const entry = entries.find((item) => item.name === name)
      if (!entry) {
        canonical = yield* fs.realPath(current)
        return {
          canonical: path.join(canonical, ...parts.slice(index)),
          exists: false,
        } satisfies Checked
      }

      const next = path.join(current, name)
      const real = yield* fs.realPath(next)
      const again = (yield* fs.readDirectoryEntries(current)).find((item) => item.name === name)
      if (!again || (again.type === "symlink" && !alias(next, real)) || again.type !== entry.type)
        return yield* Effect.fail(new Error("trusted path contains an unexpected symlink"))

      current = next
      canonical = real
      if (index === parts.length - 1) {
        return {
          canonical,
          exists: true,
          type: again.type === "symlink" && alias(next, real) ? "directory" : again.type,
        } satisfies Checked
      }
    }

    return { canonical, exists: true, type: "directory" } satisfies Checked
  })

  const dir = (value: Checked, name: string) => {
    if (value.exists && value.type !== "directory") return Effect.fail(new Error(`${name} must be a directory`))
    return Effect.void
  }

  const absent = (input: Input, worktree: string) =>
    inspect(input.fs, worktree).pipe(Effect.map((value) => !value.exists))

  const validate = Effect.fnUntraced(function* (
    input: Input,
    paths: {
      readonly root: string
      readonly project: string
      readonly directory: string
      readonly managed: string
      readonly worktree: string
      readonly gitdir: string
    },
  ) {
    const root = yield* inspect(input.fs, paths.root)
    const project = yield* inspect(input.fs, paths.project)
    const projectDir = yield* inspect(input.fs, paths.directory)
    const managed = yield* inspect(input.fs, paths.managed)
    const worktree = yield* inspect(input.fs, paths.worktree)
    const gitdir = yield* inspect(input.fs, paths.gitdir)

    yield* dir(root, "snapshot root")
    yield* dir(project, "snapshot project")
    yield* dir(projectDir, "project directory")
    yield* dir(managed, "managed worktrees directory")
    if (worktree.exists && worktree.type !== "directory")
      return yield* Effect.fail(new Error("worktree must be a directory or absent"))
    yield* dir(gitdir, "snapshot repository")

    if (!inside(root.canonical, project.canonical) || normalized(root.canonical) === normalized(project.canonical))
      return yield* Effect.fail(new Error("snapshot project is outside the snapshot root"))
    if (!inside(project.canonical, gitdir.canonical) || normalized(project.canonical) === normalized(gitdir.canonical))
      return yield* Effect.fail(new Error("snapshot repository is outside the snapshot project"))
    if (
      !inside(projectDir.canonical, managed.canonical) ||
      normalized(projectDir.canonical) === normalized(managed.canonical)
    )
      return yield* Effect.fail(new Error("managed worktrees directory is outside the project directory"))
    if (
      !inside(managed.canonical, worktree.canonical) ||
      normalized(managed.canonical) === normalized(worktree.canonical)
    )
      return yield* Effect.fail(new Error("worktree is outside the managed worktrees directory"))

    return { root, project, managed, worktree, gitdir }
  })

  const pending = Effect.fnUntraced(function* (fs: FSUtil.Interface, gitdir: string) {
    const root = yield* fs.readDirectoryEntries(gitdir)
    const names = new Set(root.map((entry) => entry.name))
    if (names.has("seed.index") || names.has("seed.index.lock") || names.has("seed-objects")) return true

    const objects = root.find((entry) => entry.name === "objects")
    if (!objects) return false
    if (objects.type !== "directory") return yield* Effect.fail(new Error("snapshot repository objects path is unsafe"))

    const objectEntries = yield* fs.readDirectoryEntries(path.join(gitdir, "objects"))
    const info = objectEntries.find((entry) => entry.name === "info")
    if (!info) return false
    if (info.type !== "directory")
      return yield* Effect.fail(new Error("snapshot repository objects info path is unsafe"))

    const markers = yield* fs.readDirectoryEntries(path.join(gitdir, "objects", "info"))
    return markers.some(
      (entry) =>
        entry.name === "alternates" || entry.name === "alternates.seed" || entry.name === "alternates.materializing",
    )
  })

  export const remove = Effect.fnUntraced(function* (input: Input) {
    const root = path.resolve(input.root)
    const directory = path.resolve(input.directory)
    const worktree = path.resolve(input.worktree)
    const managed = path.resolve(directory, ".kilo", "worktrees")
    if (!component(input.project)) return yield* Effect.fail(new Error("project must be a safe path component"))
    if (!path.isAbsolute(input.worktree) || worktree === managed || !FSUtil.contains(managed, worktree))
      return yield* Effect.fail(new Error("worktree must be an absolute path inside the managed worktrees directory"))
    const child = path.relative(managed, worktree).split(path.sep).filter(Boolean)
    if (child.length !== 1 || !component(child[0]))
      return yield* Effect.fail(new Error("worktree must be a single safe path component"))
    const gitdir = path.join(root, input.project, Hash.fast(worktree))
    if (!inside(root, gitdir) || normalized(gitdir) === normalized(root))
      return yield* Effect.fail(new Error("snapshot repository is outside the snapshot root"))

    return yield* input.flock.withLock(
      Effect.gen(function* () {
        const paths = { root, project: path.join(root, input.project), directory, managed, worktree, gitdir }
        const checked = yield* validate(input, paths)
        if (!(yield* absent(input, worktree)))
          return yield* Effect.fail(new Error("worktree must be absent before its snapshot repository is removed"))
        if (checked.project.exists) {
          const prefix = `.${path.basename(gitdir)}.cleanup-`
          const entries = yield* input.fs.readDirectoryEntries(checked.project.canonical)
          for (const entry of entries) {
            if (!entry.name.startsWith(prefix)) continue
            if (
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name.slice(prefix.length))
            )
              continue
            const target = path.join(checked.project.canonical, entry.name)
            const retained = yield* inspect(input.fs, target)
            yield* dir(retained, "snapshot cleanup quarantine")
            if (!retained.exists) continue
            if (normalized(retained.canonical) !== normalized(target) || (yield* pending(input.fs, target)))
              return yield* Effect.fail(new Error("snapshot cleanup quarantine is unsafe or still pending"))
            if (!(yield* absent(input, worktree)))
              return yield* Effect.fail(new Error("worktree must be absent before its snapshot repository is removed"))
            yield* Effect.uninterruptible(input.fs.remove(target, { recursive: true, force: true }))
          }
        }
        if (!checked.gitdir.exists) return true

        const final = yield* validate(input, paths)
        if (!(yield* absent(input, worktree)))
          return yield* Effect.fail(new Error("worktree must be absent before its snapshot repository is removed"))
        if (!final.gitdir.exists) return true
        if (yield* pending(input.fs, final.gitdir.canonical))
          return yield* Effect.fail(new Error("snapshot repository materialization is still pending"))

        const quarantine = path.join(
          path.dirname(final.gitdir.canonical),
          `.${path.basename(final.gitdir.canonical)}.cleanup-${crypto.randomUUID()}`,
        )
        const available = yield* inspect(input.fs, quarantine)
        if (available.exists) return yield* Effect.fail(new Error("snapshot cleanup quarantine already exists"))
        const moved = yield* input.fs.rename(final.gitdir.canonical, quarantine).pipe(
          Effect.as(true),
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
        )
        if (!moved) return true
        const movedPath = yield* inspect(input.fs, quarantine)
        if (
          !movedPath.exists ||
          normalized(movedPath.canonical) !== normalized(quarantine) ||
          (yield* pending(input.fs, quarantine))
        )
          return yield* Effect.fail(new Error("snapshot repository changed during cleanup"))
        yield* Effect.uninterruptible(input.fs.remove(quarantine, { recursive: true, force: true }))
        return true
      }),
      `snapshot:${gitdir}`,
    )
  })
}
