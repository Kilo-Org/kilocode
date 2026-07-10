import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as Log from "@opencode-ai/core/util/log"
import { KiloSnapshotMaterialize } from "./materialize"

export namespace KiloSnapshotSeed {
  const log = Log.create({ service: "snapshot.seed" })

  interface Result {
    readonly code: number
    readonly text: string
    readonly stderr: string
  }

  type Git = (
    cmd: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string },
  ) => Effect.Effect<Result>

  export interface Input {
    readonly dir: string
    readonly worktree: string
    readonly gitdir: string
    readonly limit: number
    readonly git: Git
    readonly fs: FSUtil.Interface
  }

  export interface Source {
    readonly gitdir: string
    readonly staging: string
    readonly hash: string
  }

  export interface Output {
    readonly source?: Source
  }

  const list = (text: string) => text.split("\0").filter(Boolean)
  const feed = (items: string[]) => items.join("\0") + "\0"
  const snap = (input: Input, cmd: string[]) => ["--git-dir", input.gitdir, "--work-tree", input.worktree, ...cmd]
  // Match the existing snapshot add() stat fanout so seeding has the same filesystem pressure.
  const concurrency = 8

  export const seed = Effect.fnUntraced(function* (input: Input) {
    const started = Date.now()
    const alt = path.join(input.gitdir, "objects", "info", "alternates")
    const pending = `${alt}.seed`
    const temp = path.join(input.gitdir, "seed.index")
    const changed = { value: false }
    const pinned = { gitdir: "", ref: "", hash: "" }
    const reset = Effect.fnUntraced(function* (reason: string, warn = false) {
      const retained = { value: false }
      if (pinned.hash) {
        const removed = yield* input.git(["--git-dir", pinned.gitdir, "update-ref", "-d", pinned.ref, pinned.hash])
        retained.value = removed.code !== 0
      }
      if (changed.value) {
        const cleared = yield* input.git(snap(input, ["read-tree", "--empty"]), { cwd: input.dir })
        if (cleared.code !== 0) {
          yield* input.fs.remove(path.join(input.gitdir, "index")).pipe(Effect.catch(() => Effect.void))
        }
        yield* input.fs.remove(path.join(input.gitdir, "index.lock")).pipe(Effect.catch(() => Effect.void))
        yield* input.fs.remove(temp).pipe(Effect.catch(() => Effect.void))
        yield* input.fs.remove(`${temp}.lock`).pipe(Effect.catch(() => Effect.void))
        yield* input.fs.remove(pending).pipe(Effect.catch(() => Effect.void))
        if (!retained.value) {
          yield* input.fs.remove(alt).pipe(Effect.catch(() => Effect.void))
          yield* input.fs
            .remove(path.join(input.gitdir, "seed-objects"), { recursive: true })
            .pipe(Effect.catch(() => Effect.void))
        }
      }
      const fields = { reason, duration: Date.now() - started }
      if (warn) log.warn("snapshot seed failed; using cold initialization", fields)
      if (!warn) log.info("snapshot seed skipped", fields)
      return {} satisfies Output
    })

    const attempt = Effect.gen(function* () {
      if (path.resolve(input.dir) !== path.resolve(input.worktree)) return yield* reset("subdirectory")

      const sparse = yield* input.git(["-C", input.worktree, "config", "--bool", "core.sparseCheckout"])
      if (sparse.code === 0 && sparse.text.trim() === "true") return yield* reset("sparse-checkout")

      const unmerged = yield* input.git(["-C", input.worktree, "ls-files", "--unmerged", "-z"])
      if (unmerged.code !== 0) return yield* reset("unmerged-check-failed", true)
      if (unmerged.text) return yield* reset("unmerged-index")

      const [src, root, idx, fmt, dst] = yield* Effect.all(
        [
          input.git(["-C", input.worktree, "rev-parse", "--path-format=absolute", "--git-dir"]),
          input.git(["-C", input.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"]),
          input.git(["-C", input.worktree, "rev-parse", "--path-format=absolute", "--git-path", "index"]),
          input.git(["-C", input.worktree, "rev-parse", "--show-object-format"]),
          input.git(["--git-dir", input.gitdir, "rev-parse", "--show-object-format"]),
        ],
        { concurrency: 5 },
      )
      if ([src, root, idx, fmt, dst].some((item) => item.code !== 0)) {
        return yield* reset("metadata", true)
      }
      if (fmt.text.trim() !== dst.text.trim()) return yield* reset("object-format")

      const source = src.text.trim()
      const common = root.text.trim()
      const index = idx.text.trim()
      if (!source || !common || !index || !(yield* input.fs.exists(index))) {
        return yield* reset("source-index")
      }

      const objects = path.join(common, "objects")
      if (!(yield* input.fs.exists(objects))) return yield* reset("source-objects")
      const staging = path.join(input.gitdir, "seed-objects")
      yield* input.fs.ensureDir(staging)
      // Borrow committed objects while writing dirty content into snapshot-owned staging.
      yield* input.fs.ensureDir(path.dirname(alt))
      changed.value = true
      yield* input.fs.writeFileString(pending, `${objects}\n${staging}\n`)
      yield* input.fs.rename(pending, alt)

      // Normalize a private index copy so write-tree cannot mutate the user's index
      // and the snapshot does not retain source-local index extensions.
      yield* input.fs.copyFile(index, temp)
      const env = {
        GIT_DIR: source,
        GIT_WORK_TREE: input.worktree,
        GIT_INDEX_FILE: temp,
      }
      const normalized = yield* input.git(
        ["update-index", "--no-split-index", "--no-fsmonitor", "--no-untracked-cache"],
        { cwd: input.dir, env },
      )
      if (normalized.code !== 0) return yield* reset("normalize-index", true)

      const tree = yield* input.git(["write-tree"], { cwd: input.dir, env })
      const hash = tree.text.trim()
      if (tree.code !== 0 || !hash) return yield* reset("write-tree", true)

      const ref = KiloSnapshotMaterialize.ref(input.gitdir)
      const pin = yield* input.git(["--git-dir", common, "update-ref", ref, hash])
      if (pin.code !== 0) return yield* reset("source-pin", true)
      pinned.gitdir = common
      pinned.ref = ref
      pinned.hash = hash
      const materialize = { gitdir: common, staging, hash }

      // Discard source stat data and entry flags so reconciliation observes the
      // filesystem under snapshot filter and line-ending semantics.
      const read = yield* input.git(snap(input, ["read-tree", hash]), { cwd: input.dir })
      if (read.code !== 0) return yield* reset("read-tree", true)
      yield* input.fs.remove(temp).pipe(Effect.catch(() => Effect.void))

      const tracked = yield* input.git(snap(input, ["ls-files", "-z", "--", "."]), { cwd: input.dir })
      if (tracked.code !== 0) return yield* reset("list", true)
      const files = list(tracked.text)
      if (!files.length) {
        log.info("snapshot seed complete", { paths: 0, dropped: 0, duration: Date.now() - started })
        return { source: materialize } satisfies Output
      }

      const ignored = yield* input.git(["-C", input.worktree, "check-ignore", "--no-index", "--stdin", "-z"], {
        stdin: feed(files),
      })
      if (ignored.code !== 0 && ignored.code !== 1) return yield* reset("ignore", true)

      const large = (yield* Effect.all(
        files.map((file) =>
          input.fs
            .stat(path.join(input.dir, file))
            .pipe(Effect.catch(() => Effect.void))
            .pipe(
              Effect.map((info) => {
                if (!info || info.type !== "File") return
                const size = typeof info.size === "bigint" ? Number(info.size) : info.size
                return size > input.limit ? file : undefined
              }),
            ),
        ),
        { concurrency },
      )).filter((file): file is string => Boolean(file))

      const dropped = Array.from(new Set([...list(ignored.text), ...large]))
      if (dropped.length) {
        const result = yield* input.git(
          snap(input, ["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]),
          { cwd: input.dir, stdin: feed(dropped) },
        )
        if (result.code !== 0) return yield* reset("drop", true)
      }

      log.info("snapshot seed complete", {
        paths: files.length,
        dropped: dropped.length,
        ignored: list(ignored.text).length,
        large: large.length,
        duration: Date.now() - started,
      })
      return { source: materialize } satisfies Output
    })

    return yield* attempt.pipe(
      Effect.onInterrupt(() => reset("interrupted", true).pipe(Effect.asVoid)),
      Effect.catch((err) => {
        log.warn("snapshot seed failed", { err })
        return reset("error", true)
      }),
    )
  })
}
