import { expect } from "bun:test"
import { Effect, Ref } from "effect"
import * as Refresh from "@opencode-ai/core/kilocode/models-refresh"
import * as ModelsRefresh from "../../src/kilocode/provider/models-refresh"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider/models"
import { it } from "../lib/effect"

it.effect(
  "reloads models.dev and Kilo Gateway before notifying provider state",
  Effect.gen(function* () {
    const calls = yield* Ref.make<string[]>([])
    const models = ModelsDev.Service.of({
      get: () => Ref.update(calls, (items) => [...items, "models:get"]).pipe(Effect.as({})),
      refresh: (force) => Ref.update(calls, (items) => [...items, `models.dev:${force}`]),
    })
    const cache = ModelCache.Service.of({
      getFailure: () => Effect.succeed(undefined),
      failedProviders: () => Effect.succeed([]),
      get: () => Effect.succeed(undefined),
      fetch: () => Effect.succeed({}),
      refresh: () => Effect.succeed({}),
      clear: (provider) => Ref.update(calls, (items) => [...items, `gateway:clear:${provider}`]),
    })

    yield* Refresh.watch(() => Ref.update(calls, (items) => [...items, "notify"]))
    yield* ModelsRefresh.refresh(models, cache)

    expect(yield* Ref.get(calls)).toEqual([
      "models.dev:true",
      "gateway:clear:kilo",
      "models:get",
      "notify",
    ])
  }),
)
