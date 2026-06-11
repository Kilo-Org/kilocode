import { Effect } from "effect"

type Result = { code: number; text: string; stderr: string }
type Run = (cmd: string[], env?: Record<string, string>) => Effect.Effect<Result>

const ref = "refs/kilo/snapshots"
const zero = "0000000000000000000000000000000000000000"

export namespace SnapshotPin {
  export const pin = Effect.fn("SnapshotPin.pin")(function* (hash: string, run: Run) {
    const current = yield* run(["rev-parse", "--verify", "--quiet", ref])
    if (current.code !== 0 && current.code !== 1) return false
    const tip = current.code === 0 ? current.text.trim() : undefined
    if (tip) {
      const tree = yield* run(["show", "-s", "--format=%T", tip])
      if (tree.code === 0 && tree.text.trim() === hash) return true
    }

    const env = {
      GIT_AUTHOR_NAME: "Kilo Snapshot",
      GIT_AUTHOR_EMAIL: "snapshot@kilo.local",
      GIT_COMMITTER_NAME: "Kilo Snapshot",
      GIT_COMMITTER_EMAIL: "snapshot@kilo.local",
    }
    const commit = yield* run(["commit-tree", hash, ...(tip ? ["-p", tip] : []), "-m", hash], env)
    if (commit.code !== 0) return false
    const update = yield* run(["update-ref", ref, commit.text.trim(), tip ?? zero])
    return update.code === 0
  })
}
