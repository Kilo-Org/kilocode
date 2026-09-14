import { Effect } from "effect"
import path from "path"
import { KiloSnapshotSeed } from "./seed"
import { KiloSnapshotMaterialize } from "./materialize"
import type { Snapshot } from "@/snapshot"

export namespace KiloSnapshotPrepare {
  /** Marks a repository whose seed finished before any snapshot was tracked. */
  export const MARKER = "kilo-prepared"

  // Snapshot repositories hash worktree bytes as-is and never run a filesystem monitor.
  // The index and untracked-cache settings keep per-step scans cheap in large worktrees.
  const CONFIG = [
    "[core]",
    "\tautocrlf = false",
    "\tlongpaths = true",
    "\tsymlinks = true",
    "\tfsmonitor = false",
    "\tuntrackedCache = true",
    "[feature]",
    "\tmanyFiles = true",
    "[index]",
    "\tversion = 4",
    "\tthreads = true",
    "",
  ].join("\n")

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
    const marker = path.join(input.gitdir, MARKER)
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
    // Preparation runs detached from session creation, so it can arrive after the
    // worktree was removed. Do not recreate a repository for a worktree that is gone.
    if (prepare && !(yield* input.fs.exists(input.worktree).pipe(Effect.orDie))) return
    yield* input.fs.ensureDir(input.gitdir).pipe(Effect.orDie)
    return yield* Effect.gen(function* () {
      const result = yield* input.git(["init"], { env: { GIT_DIR: input.gitdir, GIT_WORK_TREE: input.worktree } })
      if (result.code !== 0) return yield* Effect.die(new Error(`Snapshot initialization failed: ${result.stderr}`))
      // One config write replaces a spawn per key. Repeated sections are valid git config.
      const config = path.join(input.gitdir, "config")
      const current = yield* input.fs.readFileString(config).pipe(Effect.catch(() => Effect.succeed("")))
      yield* input.fs.writeFileString(config, current.trimEnd() + "\n" + CONFIG).pipe(Effect.orDie)
      const seeded: KiloSnapshotSeed.Output = yield* KiloSnapshotSeed.seed(input)
      if (prepare) yield* input.fs.writeFileString(path.join(input.gitdir, MARKER), "").pipe(Effect.orDie)
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
