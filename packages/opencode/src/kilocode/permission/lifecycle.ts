import { Effect } from "effect"

export namespace KiloPermission {
  export const abort = (signal: AbortSignal) => {
    if (signal.aborted) return Effect.interrupt
    return Effect.callback<never>((resume) => {
      const state = { done: false }
      const stop = () => {
        if (state.done) return
        state.done = true
        resume(Effect.interrupt)
      }
      signal.addEventListener("abort", stop, { once: true })
      if (signal.aborted) stop()
      return Effect.sync(() => signal.removeEventListener("abort", stop))
    })
  }

  export const finalize = <ID, Value>(input: { pending: Map<ID, Value>; id: ID; publish: () => Effect.Effect<void> }) =>
    Effect.gen(function* () {
      if (!input.pending.delete(input.id)) return
      yield* input.publish()
    })
}
