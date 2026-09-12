import { Effect } from "effect"
import path from "path"
import { KiloSnapshotSeed } from "./seed"
import { KiloSnapshotMaterialize } from "./materialize"
import type { Snapshot } from "@/snapshot"

export namespace KiloSnapshotPrepare {
  const services = new WeakMap<Snapshot.Interface, () => Effect.Effect<boolean>>()

  export function bind(service: Snapshot.Interface, prepare: () => Effect.Effect<boolean>) {
    services.set(service, prepare)
    return service
  }

  export const run = Effect.fnUntraced(function* (service: Snapshot.Interface) {
    const prepare = services.get(service)
    if (!prepare) return yield* Effect.die(new Error("Snapshot preparation is unavailable"))
    return yield* prepare()
  })

  // Called under the snapshot lock so preparation cannot race startup recovery.
  export const resume = Effect.fnUntraced(function* (input: KiloSnapshotMaterialize.Input) {
    const marker = path.join(input.gitdir, "kilo-prepared")
    if (yield* input.fs.exists(marker)) {
      const refs = yield* input.git([
        "--git-dir",
        input.gitdir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/kilo/snapshots",
      ])
      if (refs.code === 0 && !refs.text.trim()) return false
      if (refs.code === 0) yield* input.fs.remove(marker)
    }
    return yield* KiloSnapshotMaterialize.run(input)
  })

  export const initialize = Effect.fnUntraced(function* (input: KiloSnapshotSeed.Input, prepare = false) {
    if (yield* input.fs.exists(input.gitdir).pipe(Effect.orDie)) return
    yield* input.fs.ensureDir(input.gitdir).pipe(Effect.orDie)
    const commands = [
      ["init"],
      ["--git-dir", input.gitdir, "config", "core.autocrlf", "false"],
      ["--git-dir", input.gitdir, "config", "core.longpaths", "true"],
      ["--git-dir", input.gitdir, "config", "core.symlinks", "true"],
      ["--git-dir", input.gitdir, "config", "core.fsmonitor", "false"],
    ]
    return yield* Effect.gen(function* () {
      for (const cmd of commands) {
        const result = yield* input.git(cmd, {
          env: { GIT_DIR: input.gitdir, GIT_WORK_TREE: input.worktree },
        })
        if (result.code !== 0) return yield* Effect.die(new Error(`Snapshot initialization failed: ${result.stderr}`))
      }
      const seeded: KiloSnapshotSeed.Output = yield* KiloSnapshotSeed.seed(input)
      if (prepare) yield* input.fs.writeFileString(path.join(input.gitdir, "kilo-prepared"), "").pipe(Effect.orDie)
      yield* Effect.logInfo("initialized")
      return seeded
    }).pipe(
      Effect.onExit((exit) =>
        exit._tag === "Success"
          ? Effect.void
          : input.fs.remove(input.gitdir, { recursive: true, force: true }).pipe(Effect.orDie),
      ),
    )
  })
}
