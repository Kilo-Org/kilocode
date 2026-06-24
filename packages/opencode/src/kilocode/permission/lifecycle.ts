import { Effect } from "effect"

export namespace KiloPermission {
  export const finalize = <ID, Value>(input: { pending: Map<ID, Value>; id: ID; publish: () => Effect.Effect<void> }) =>
    Effect.gen(function* () {
      if (!input.pending.delete(input.id)) return
      yield* input.publish()
    })
}
