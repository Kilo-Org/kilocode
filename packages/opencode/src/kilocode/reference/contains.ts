import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { Resolved } from "@/kilocode/reference"

export namespace KiloReference {
  export const contains = Effect.fn("KiloReference.contains")(function* (input: {
    fs: Pick<FSUtil.Interface, "realPath">
    references: Resolved[]
    target: string
  }) {
    for (const reference of input.references) {
      if (reference.kind !== "git") continue
      if (yield* path(input.fs, reference.path, input.target)) return true
    }
    return false
  })

  export const path = Effect.fn("KiloReference.path")(function* (
    fs: Pick<FSUtil.Interface, "realPath">,
    reference: string,
    target: string,
  ) {
    const resolved = yield* fs.realPath(reference).pipe(Effect.option)
    if (resolved._tag === "None") return false
    return FSUtil.contains(FSUtil.normalizePath(resolved.value), target)
  })
}
