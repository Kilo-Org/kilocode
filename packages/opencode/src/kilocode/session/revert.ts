import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Instance } from "@/kilocode/instance"
import type { Snapshot } from "@/snapshot"

export namespace KiloSessionRevert {
  export const apply = Effect.fn("KiloSessionRevert.apply")(function* (
    snap: Snapshot.Interface,
    patches: Snapshot.Patch[],
    baseline?: string,
  ) {
    return yield* snap.revert(patches).pipe(
      Effect.catchCause((cause) => {
        if (!baseline) return Effect.failCause(cause)
        return restore(snap, baseline).pipe(Effect.andThen(Effect.failCause(cause)))
      }),
    )
  })

  export const restore = Effect.fn("KiloSessionRevert.restore")(function* (snap: Snapshot.Interface, hash: string) {
    const current = yield* snap.track()
    const removed = current
      ? (yield* snap.diffFull(hash, current)).flatMap((file) =>
          file.status === "added" && file.file ? [path.resolve(Instance.directory, file.file)] : [],
        )
      : []

    yield* snap.restore(hash)
    yield* Effect.forEach(removed, (file) => Effect.promise(() => fs.rm(file, { force: true, recursive: true })), {
      discard: true,
    })
  })
}
