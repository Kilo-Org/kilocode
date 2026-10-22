import { Effect } from "effect"

export function runner<E>(cancelled: () => E) {
  return <T>(effect: Effect.Effect<T, E>, signal: AbortSignal) => {
    const abort = Effect.callback<never, E>((resume) => {
      const err = () => cancelled()
      if (signal.aborted) return resume(Effect.fail(err()))
      const handler = () => resume(Effect.fail(err()))
      signal.addEventListener("abort", handler, { once: true })
      return Effect.sync(() => signal.removeEventListener("abort", handler))
    })
    return effect.pipe(Effect.raceFirst(abort), Effect.orDie)
  }
}
