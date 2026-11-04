export * as SnapshotCleanup from "./snapshot.js"

import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Schema } from "effect"
import path from "path"

export class InvalidWorktreeError extends Schema.TaggedError<InvalidWorktreeError>()(
  "AgentManager.InvalidWorktreeError",
  { message: Schema.String },
) {}

export interface Input {
  readonly data: string
  readonly project: string
  readonly directory: string
  readonly worktree: string
  readonly fs: FSUtil.Interface
}

type Checked = {
  readonly canonical: string
  readonly exists: boolean
  readonly type?: "directory" | "other"
}

const normalized = (value: string) => {
  const result = path.normalize(value)
  return process.platform === "win32" ? result.toLowerCase() : result
}

const inside = (parent: string, child: string) => FSUtil.contains(normalized(parent), normalized(child))

const component = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)

const managedLexically = (managed: string, worktree: string) =>
  inside(managed, worktree) ||
  (process.platform === "darwin" &&
    inside(managed.replace(/^\/private/, ""), worktree.replace(/^\/private/, "")))

// macOS reports /var and /tmp through a /private alias. VS Code may send either spelling.
const alias = (value: string, canonical: string) =>
  process.platform === "darwin" &&
  canonical === `/private${value}` &&
  ["/var", "/tmp"].some((root) => value === root || value.startsWith(`${root}/`))

const invalid = (message: string) => Effect.fail(new InvalidWorktreeError({ message }))

const inspect = Effect.fnUntraced(function* (fs: FSUtil.Interface, target: string) {
  const missing: string[] = []
  let current = target

  while (true) {
    const canonical = yield* fs
      .realPath(current)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    if (canonical !== undefined) {
      if (normalized(canonical) !== normalized(current) && !alias(current, canonical))
        return yield* invalid("trusted path contains an unexpected symlink")
      const info = yield* fs.stat(current)
      if (missing.length > 0 && info.type !== "Directory")
        return yield* invalid("trusted path parent is not a directory")
      if (normalized(yield* fs.realPath(current)) !== normalized(canonical))
        return yield* invalid("trusted path changed during inspection")
      return {
        canonical: path.join(canonical, ...missing),
        exists: missing.length === 0,
        type: info.type === "Directory" ? "directory" : "other",
      } satisfies Checked
    }

    const link = yield* fs
      .readLink(current)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    if (link !== undefined) return yield* invalid("trusted path contains an unexpected symlink")
    const parent = path.dirname(current)
    if (parent === current) return yield* invalid("trusted path root is missing")
    missing.unshift(path.basename(current))
    current = parent
  }
})

const dir = (value: Checked, name: string) => {
  if (value.exists && value.type !== "directory") return invalid(`${name} must be a directory`)
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
    return yield* invalid("worktree must be a directory or absent")
  yield* dir(gitdir, "snapshot repository")

  if (!inside(root.canonical, project.canonical) || normalized(root.canonical) === normalized(project.canonical))
    return yield* invalid("snapshot project is outside the snapshot root")
  if (!inside(project.canonical, gitdir.canonical) || normalized(project.canonical) === normalized(gitdir.canonical))
    return yield* invalid("snapshot repository is outside the snapshot project")
  if (
    !inside(projectDir.canonical, managed.canonical) ||
    normalized(projectDir.canonical) === normalized(managed.canonical)
  )
    return yield* invalid("managed worktrees directory is outside the project directory")
  if (
    !inside(managed.canonical, worktree.canonical) ||
    normalized(managed.canonical) === normalized(worktree.canonical)
  )
    return yield* invalid("worktree is outside the managed worktrees directory")

  return { root, project, managed, worktree, gitdir }
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// kilo_port(snapshot:80d332891272)
/**
 * Removes the snapshot repository of a managed worktree that is already gone. The worktree path is checked
 * lexically and against symlinks, the repository path is derived from the project and the canonical worktree
 * path, and the repository is moved aside before removal so an interrupted cleanup can finish on the next call.
 */
export const remove = Effect.fn("SnapshotCleanup.remove")(function* (input: Input) {
  // Windows can spell the same directory with an 8.3 short name. Resolve the inputs first, so the
  // symlink inspection below compares real paths instead of two spellings of the same directory.
  const real = (value: string) =>
    input.fs.realPath(value).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(value)))
  const root = path.resolve(yield* real(input.data), "snapshot")
  const directory = path.resolve(yield* real(input.directory))
  const worktree = path.resolve(input.worktree)
  const managed = path.resolve(directory, ".kilo", "worktrees")
  if (!component(input.project)) return yield* invalid("project must be a safe path component")
  if (!path.isAbsolute(input.worktree) || worktree === managed || !managedLexically(managed, worktree))
    return yield* invalid("worktree must be an absolute path inside the managed worktrees directory")

  // Snapshot repositories are keyed by the canonical worktree path, also when the worktree is gone.
  const managedChecked = yield* inspect(input.fs, managed)
  const worktreeChecked = yield* inspect(input.fs, worktree)
  const canonicalWorktree = worktreeChecked.canonical
  if (!inside(managedChecked.canonical, canonicalWorktree) || normalized(managedChecked.canonical) === normalized(canonicalWorktree))
    return yield* invalid("worktree is outside the managed worktrees directory")
  const child = path.relative(managedChecked.canonical, canonicalWorktree).split(path.sep).filter(Boolean)
  if (child.length !== 1 || !component(child[0]!))
    return yield* invalid("worktree must be a single safe path component")
  const gitdir = path.join(root, input.project, Hash.fast(canonicalWorktree))
  if (!inside(root, gitdir) || normalized(gitdir) === normalized(root))
    return yield* invalid("snapshot repository is outside the snapshot root")

  const checked = yield* validate(input, { root, project: path.join(root, input.project), directory, managed, worktree, gitdir })
  if (!(yield* absent(input, worktree)))
    return yield* invalid("worktree must be absent before its snapshot repository is removed")

  let removed = false
  if (checked.project.exists) {
    const prefix = `.${path.basename(gitdir)}.cleanup-`
    const entries = yield* input.fs.readDirectoryEntries(checked.project.canonical)
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix) || !UUID.test(entry.name.slice(prefix.length))) continue
      const target = path.join(checked.project.canonical, entry.name)
      const retained = yield* inspect(input.fs, target)
      yield* dir(retained, "snapshot cleanup quarantine")
      if (!retained.exists) continue
      if (normalized(retained.canonical) !== normalized(target))
        return yield* invalid("snapshot cleanup quarantine is unsafe")
      if (!(yield* absent(input, worktree)))
        return yield* invalid("worktree must be absent before its snapshot repository is removed")
      yield* Effect.uninterruptible(input.fs.remove(target, { recursive: true, force: true }))
      removed = true
    }
  }
  if (!checked.gitdir.exists) return removed

  const final = yield* validate(input, { root, project: path.join(root, input.project), directory, managed, worktree, gitdir })
  if (!(yield* absent(input, worktree)))
    return yield* invalid("worktree must be absent before its snapshot repository is removed")
  if (!final.gitdir.exists) return true

  const quarantine = path.join(
    path.dirname(final.gitdir.canonical),
    `.${path.basename(final.gitdir.canonical)}.cleanup-${crypto.randomUUID()}`,
  )
  const available = yield* inspect(input.fs, quarantine)
  if (available.exists) return yield* invalid("snapshot cleanup quarantine already exists")
  const moved = yield* input.fs.rename(final.gitdir.canonical, quarantine).pipe(
    Effect.as(true),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
  )
  if (!moved) return true
  const movedPath = yield* inspect(input.fs, quarantine)
  if (!movedPath.exists || normalized(movedPath.canonical) !== normalized(quarantine))
    return yield* invalid("snapshot repository changed during cleanup")
  yield* Effect.uninterruptible(input.fs.remove(quarantine, { recursive: true, force: true }))
  return true
})
