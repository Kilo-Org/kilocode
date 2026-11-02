import { expect } from "bun:test"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Provider } from "@opencode/core/provider"
import { Model } from "@opencode/schema/model"
import { Effect, Layer } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayModel } from "../src/gateway-model"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const other = Provider.ID.make("openrouter")

it.effect("an empty Kilo credential keeps image and decision models off the stale lower-priority key", () =>
  Effect.gen(function* () {
    const calls: string[] = []
    const base = Layer.succeed(ModelResolver.Service, {
      resolve: () => Effect.undefined,
      resolveModel: () => Effect.die("not used"),
      resolveImage: (ref) => Effect.sync(() => calls.push(`image:${ref.providerID}`)).pipe(Effect.as(undefined)),
      resolveDecision: (ref) => Effect.sync(() => calls.push(`decision:${ref.providerID}`)).pipe(Effect.as(undefined)),
    })
    const providers = yield* Provider.Service
    const media = Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      for (const providerID of [kilo, other]) {
        const ref = Model.Ref.make({ providerID, id: Model.ID.make("image") })
        expect(yield* resolver.resolveImage(ref)).toBeUndefined()
        expect(yield* resolver.resolveDecision(ref)).toBeUndefined()
      }
    }).pipe(Effect.provide(KiloGatewayModel.resolverLayer(base)))

    yield* providers.transform((editor) =>
      editor.update(kilo, (provider) => {
        provider.settings = { kiloEmptyToken: true }
      }),
    )
    yield* media
    expect(calls).toEqual(["image:openrouter", "decision:openrouter"])

    calls.length = 0
    yield* providers.transform((editor) =>
      editor.update(kilo, (provider) => {
        provider.settings = { kiloEmptyToken: false }
      }),
    )
    yield* media
    expect(calls).toEqual(["image:kilo", "decision:kilo", "image:openrouter", "decision:openrouter"])
  }),
)
