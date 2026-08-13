export namespace KiloSessionTuiSync {
  export function model(input: { role: string; parts?: readonly { type: string }[] }) {
    if (input.role !== "user") return false
    if (!input.parts) return false
    return !input.parts.some((part) => part.type === "compaction")
  }

  export type RestoredModel = {
    providerID: string
    modelID: string
    variant?: string
  }

  export type Restore =
    | { type: "skip" }
    | { type: "stale"; model: RestoredModel }
    | { type: "apply"; model: RestoredModel }

  /**
   * Opening an old session restores its last user model into the global picker. If the live
   * catalog no longer has that ID (a retired Kilo Gateway slug, for example) it must not be
   * pinned, and its variant must not leak onto whatever model stays selected - the picker keeps
   * its current valid pick and the caller surfaces the stale ID so the user can re-pick.
   */
  export function restore(input: {
    model?: RestoredModel
    valid: (model: { providerID: string; modelID: string }) => boolean
  }): Restore {
    if (!input.model) return { type: "skip" }
    if (!input.valid(input.model)) return { type: "stale", model: input.model }
    return { type: "apply", model: input.model }
  }
}
