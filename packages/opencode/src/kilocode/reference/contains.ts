import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { Reference, Resolved } from "@/reference/reference"

export namespace KiloReference {
  export const contains = Effect.fn("KiloReference.contains")(function* (input: {
    fs: Pick<FSUtil.Interface, "realPath">
    references: Pick<Reference.Interface, "list">
    target: string
  }) {
    const refs = yield* input.references.list()
    for (const reference of refs) {
      if (reference.kind !== "git") continue
      if (yield* root(input.fs, reference, input.target)) return true
    }
    return false
  })

  export const root = Effect.fn("KiloReference.root")(function* (
    fs: Pick<FSUtil.Interface, "realPath">,
    reference: Exclude<Resolved, { kind: "invalid" }>,
    target: string,
  ) {
    return yield* path(fs, reference.path, target)
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
