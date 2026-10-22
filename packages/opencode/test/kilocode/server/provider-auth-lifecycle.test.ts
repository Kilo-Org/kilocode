import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { invalidateAfterProviderAuthChange } from "../../../src/kilocode/server/provider-auth-lifecycle"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

function layer(events: Ref.Ref<string[]>) {
  return Layer.mergeAll(
    Layer.mock(ModelCache.Service)({
      clear: (providerID) => Ref.update(events, (items) => [...items, `clear:${providerID}`]),
    }),
    Layer.mock(InstanceStore.Service)({
      disposeAll: () => Ref.update(events, (items) => [...items, "dispose"]),
    }),
  )
}

it.effect("clears provider models before disposing instances after auth changes", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<string[]>([])

    yield* invalidateAfterProviderAuthChange("kilo").pipe(Effect.provide(layer(events)))

    expect(yield* Ref.get(events)).toEqual(["clear:kilo", "dispose"])
  }),
)
