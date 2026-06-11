import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Instance } from "@/project/instance"
import type { MessageV2 } from "@/session/message-v2"
import type { Snapshot } from "@/snapshot"

export namespace KiloSessionRevert {
  export function normalize(info: MessageV2.Assistant, parts: MessageV2.Part[]) {
    const finishes = parts.filter((part): part is MessageV2.StepFinishPart => part.type === "step-finish")
    const next = structuredClone(info)
    next.cost = finishes.reduce((sum, part) => sum + part.cost, 0)
    next.tokens = finishes.reduce(
      (sum, part) => ({
        total: (sum.total ?? 0) + (part.tokens.total ?? 0),
        input: sum.input + part.tokens.input,
        output: sum.output + part.tokens.output,
        reasoning: sum.reasoning + part.tokens.reasoning,
        cache: {
          read: sum.cache.read + part.tokens.cache.read,
          write: sum.cache.write + part.tokens.cache.write,
        },
      }),
      { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    )
    const finish = finishes.at(-1)
    if (finish) next.finish = finish.reason
    if (!finish) {
      delete next.finish
      delete next.time.completed
    }
    delete next.error
    delete next.structured
    return next
  }

    export const apply = Effect.fn("KiloSessionRevert.apply")(function* (
    snapshot: Snapshot.Interface,
    patches: Snapshot.Patch[],
    baseline?: string,
  ) {
    return yield* snapshot.revert(patches).pipe(
      Effect.catchCause((cause) => {
        if (!baseline) return Effect.failCause(cause)
        return restore(snapshot, baseline).pipe(Effect.andThen(Effect.failCause(cause)))
      }),
    )
  })

  export const restore = Effect.fn("KiloSessionRevert.restore")(function* (
snapshot: Snapshot.Interface, hash: string) {
    const current = yield* snapshot.track()
    const removed = current
      ? (yield* snapshot.diffFull(hash, current)).flatMap((file) =>
          file.status === "added" && file.file ? [path.resolve(Instance.directory, file.file)] : [],
        )
      : []

    yield* snapshot.restore(hash)
    yield* Effect.forEach(removed, (file) => Effect.promise(() => fs.rm(file, { force: true, recursive: true })), {
      discard: true,
    })
  })
}
