import { Effect } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { Hash } from "@opencode-ai/core/util/hash"

export namespace KiloSnapshotMaterialize {
  const log = Log.create({ service: "snapshot.materialize" })

  interface Result {
    readonly code: number
    readonly text: string
    readonly stderr: string
  }

  export type Git = (
    cmd: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string },
  ) => Effect.Effect<Result>

  export interface Input {
    readonly gitdir: string
    readonly git: Git
    readonly fs: AppFileSystem.Interface
  }

  export const ref = (gitdir: string) => `refs/kilo/materialize/${Hash.fast(path.resolve(gitdir))}`
  const snapshotRef = (hash: string, time = Date.now()) => `refs/kilo/snapshots/${time}/${hash}`

  const pack = Effect.fnUntraced(function* (input: Input, dir: string, name: string, objects: string[]) {
    if (!objects.length) return true
    yield* input.fs.ensureDir(dir).pipe(Effect.catch(() => Effect.void))
    const result = yield* input.git(["--git-dir", input.gitdir, "pack-objects", "--non-empty", path.join(dir, name)], {
      stdin: `${objects.join("\n")}\n`,
    })
    if (result.code === 0 && result.text.trim()) return true
    log.warn("failed to localize snapshot objects", { name, objects: objects.length, stderr: result.stderr })
    return false
  })

  export const pin = Effect.fnUntraced(function* (input: Input, hash: string) {
    const result = yield* input.git(["--git-dir", input.gitdir, "update-ref", snapshotRef(hash), hash])
    if (result.code === 0) return true
    log.warn("failed to pin snapshot", { hash, stderr: result.stderr })
    return false
  })

  export const localize = Effect.fnUntraced(function* (
    input: Input & { readonly staging: string; readonly seed: string },
  ) {
    const diff = yield* input.git([
      "--git-dir",
      input.gitdir,
      "diff-index",
      "--cached",
      "--name-only",
      "-z",
      input.seed,
    ])
    if (diff.code !== 0) return false
    const files = new Set(diff.text.split("\0").filter(Boolean))
    if (!files.size) return true

    const listed = yield* input.git(["--git-dir", input.gitdir, "ls-files", "--stage", "-z"])
    if (listed.code !== 0) return false
    const objects = Array.from(
      new Set(
        listed.text.split("\0").flatMap((line) => {
          const match = line.match(/^(\d+) ([0-9a-f]+) 0\t(.*)$/)
          if (!match || match[1] === "160000" || !files.has(match[3])) return []
          return [match[2]]
        }),
      ),
    )
    return yield* pack(input, path.join(input.staging, "pack"), "changed", objects)
  })

  export const localizeTrees = Effect.fnUntraced(function* (input: Input & { readonly staging: string }, hash: string) {
    const listed = yield* input.git(["--git-dir", input.gitdir, "ls-tree", "-r", "-t", "-z", hash])
    if (listed.code !== 0) return false
    const objects = Array.from(
      new Set([
        hash,
        ...listed.text.split("\0").flatMap((line) => {
          const match = line.match(/^\d+ tree ([0-9a-f]+)\t/)
          return match ? [match[1]] : []
        }),
      ]),
    )
    return yield* pack(input, path.join(input.staging, "pack"), "trees", objects)
  })

  export const prune = Effect.fnUntraced(function* (input: Input, before: number) {
    const result = yield* input.git([
      "--git-dir",
      input.gitdir,
      "for-each-ref",
      "--format=%(refname)",
      "refs/kilo/snapshots",
    ])
    if (result.code !== 0) {
      log.warn("failed to list snapshot pins for pruning", { stderr: result.stderr })
      return false
    }
    const refs = result.text
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => {
        const match = item.match(/^refs\/kilo\/snapshots\/(\d+)\/[0-9a-f]+$/)
        if (!match) return false
        const time = Number(match[1])
        return Number.isSafeInteger(time) && time < before
      })
    if (!refs.length) return true
    const removed = yield* input.git(["--git-dir", input.gitdir, "update-ref", "--stdin"], {
      stdin: refs.map((item) => `delete ${item}`).join("\n") + "\n",
    })
    if (removed.code === 0) return true
    log.warn("failed to prune snapshot pins", { refs: refs.length, stderr: removed.stderr })
    return false
  })

  export const run = Effect.fnUntraced(function* (input: Input) {
    const started = Date.now()
    const alt = path.join(input.gitdir, "objects", "info", "alternates")
    const hold = `${alt}.materializing`
    if (!(yield* input.fs.exists(alt)) && (yield* input.fs.exists(hold))) yield* input.fs.rename(hold, alt)
    if (!(yield* input.fs.exists(alt))) {
      yield* Effect.all(
        [
          input.fs.remove(`${alt}.seed`).pipe(Effect.catch(() => Effect.void)),
          input.fs
            .remove(path.join(input.gitdir, "seed-objects"), { recursive: true })
            .pipe(Effect.catch(() => Effect.void)),
        ],
        { discard: true },
      )
      return false
    }
    const text = yield* input.fs.readFileString(alt)

    const refs = yield* input.git([
      "--git-dir",
      input.gitdir,
      "for-each-ref",
      "--format=%(objectname)",
      "refs/kilo/snapshots",
    ])
    if (refs.code !== 0) {
      log.warn("failed to list snapshot pins", { stderr: refs.stderr })
      return false
    }
    const roots = yield* Effect.gen(function* () {
      const listed = Array.from(
        new Set(
          refs.text
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      )
      if (listed.length) return listed
      const tree = yield* input.git(["--git-dir", input.gitdir, "write-tree"])
      const hash = tree.text.trim()
      if (tree.code !== 0 || !hash) return []
      if (!(yield* pin(input, hash))) return []
      return [hash]
    })
    if (!roots.length) return false

    // Without --local, repack copies all reachable objects from alternates into this repository.
    const packed = yield* input.git(["--git-dir", input.gitdir, "repack", "-a", "-d", "--no-write-bitmap-index"])
    if (packed.code !== 0) {
      log.warn("failed to repack snapshot objects", { stderr: packed.stderr })
      return false
    }

    const source = yield* Effect.gen(function* () {
      const objects = text
        .split("\n")
        .map((item) => item.trim())
        .find(Boolean)
      if (!objects || path.basename(objects) !== "objects") return
      const gitdir = path.dirname(objects)
      const name = ref(input.gitdir)
      const result = yield* input.git(["--git-dir", gitdir, "rev-parse", "--verify", name])
      const hash = result.text.trim()
      if (result.code !== 0 || !hash) return
      return { gitdir, ref: name, hash }
    })

    const connected = yield* Effect.acquireUseRelease(
      input.fs.rename(alt, hold),
      () =>
        input.git([
          "--git-dir",
          input.gitdir,
          "fsck",
          "--connectivity-only",
          "--no-dangling",
          "--no-reflogs",
          "--no-progress",
        ]),
      () => input.fs.rename(hold, alt).pipe(Effect.orDie),
    )

    if (!(yield* input.fs.exists(alt))) return false
    if (connected.code !== 0) {
      log.warn("snapshot pack failed local connectivity check", { stderr: connected.stderr })
      return false
    }

    if (source) {
      const removed = yield* input.git(["--git-dir", source.gitdir, "update-ref", "-d", source.ref, source.hash])
      if (removed.code !== 0) {
        log.warn("failed to remove source snapshot pin", { stderr: removed.stderr })
        return false
      }
    }
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* input.fs.remove(alt)
        yield* input.fs
          .remove(path.join(input.gitdir, "seed-objects"), { recursive: true })
          .pipe(Effect.catch(() => Effect.void))
      }),
    )
    log.info("snapshot objects materialized", { roots: roots.length, duration: Date.now() - started })
    return true
  })
}
