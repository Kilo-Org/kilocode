import { Effect } from "effect"

type Listener = () => Effect.Effect<void>

const listeners = new Set<Listener>()

export const notify = Effect.fn("ModelsRefresh.notify")(function* () {
  yield* Effect.forEach([...listeners], (listener) => Effect.exit(listener()), { discard: true })
})

export const watch = (listener: Listener) =>
  Effect.gen(function* () {
    listeners.add(listener)
    yield* Effect.addFinalizer(() => Effect.sync(() => listeners.delete(listener)))
  })
