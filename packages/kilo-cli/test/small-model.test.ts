import { expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { location } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { KiloSmallModel } from "../src/small-model"

const it = testEffect(
  Layer.fresh(
    AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node]), [
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
        ),
      ),
    ]),
  ),
)

function model(providerID: string, id: string, overrides: Partial<Model.Info> = {}): Model.Info {
  return { ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)), ...overrides }
}

const primary = model("local", "chat")
const router = model("kilo", "kilo-auto/small", {
  family: Model.Family.make("router"),
  settings: { kiloCredentials: true },
})

const seed = Effect.fn(function* (items: Model.Info[]) {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    for (const id of new Set(items.map((item) => item.providerID))) {
      editor.add({
        info: { ...Provider.Info.empty(id), activation: "enabled" },
        models: items.filter((item) => item.providerID === id),
      })
    }
  })
  return yield* Model.Service
})

it.effect("prefers the exact Kilo small router despite its backend family and missing credentials", () =>
  Effect.gen(function* () {
    const native = model("kilo", "gemini-flash", { family: Model.Family.make("gemini-flash") })
    const models = yield* seed([native, { ...router, settings: { kiloCredentials: false } }])
    expect((yield* models.small(router.providerID))?.id).toBe(native.id)
    expect(yield* KiloSmallModel.select(models, router.providerID)).toMatchObject({ id: router.id, family: "router" })
  }),
)

it.effect("preserves the primary provider's native small model before authenticated cloud fallback", () =>
  Effect.gen(function* () {
    const native = model("local", "fast", { family: Model.Family.make("claude-haiku") })
    const models = yield* seed([primary, native, router])
    const selected = yield* KiloSmallModel.select(models, primary.providerID)
    expect(selected).toEqual(yield* models.small(primary.providerID))
    expect(selected?.id).toBe(native.id)
  }),
)

for (const credentials of [undefined, false, true]) {
  it.effect(`gates cross-provider fallback on kiloCredentials === true (${credentials})`, () =>
    Effect.gen(function* () {
      const models = yield* seed([
        primary,
        {
          ...router,
          settings: {
            ...(credentials === undefined ? {} : { kiloCredentials: credentials }),
            apiKey: credentials ? "anonymous" : "configured-key",
          },
        },
      ])
      expect(yield* models.small(primary.providerID)).toBeUndefined()
      const selected = yield* KiloSmallModel.select(models, primary.providerID)
      if (credentials === true) expect(selected).toMatchObject({ providerID: router.providerID, id: router.id })
      if (credentials !== true) expect(selected).toBeUndefined()
    }),
  )
}

it.effect("does not fall back to Kilo for a missing provider", () =>
  Effect.gen(function* () {
    const models = yield* seed([router])
    expect(yield* KiloSmallModel.select(models, Provider.ID.make("missing"))).toBeUndefined()
  }),
)

for (const providerID of ["azure", "azure-cognitive-services"]) {
  it.effect(`preserves the ${providerID} early return before native and cloud selection`, () =>
    Effect.gen(function* () {
      const native = model(providerID, "deployment", { family: Model.Family.make("claude-haiku") })
      const models = yield* seed([native, router])
      expect((yield* models.small(native.providerID))?.id).toBe(native.id)
      expect(yield* KiloSmallModel.select(models, native.providerID)).toBeUndefined()
    }),
  )
}

for (const state of ["absent", "disabled"]) {
  it.effect(`does not select an ${state} router even with credentials`, () =>
    Effect.gen(function* () {
      const models = yield* seed([
        primary,
        model("kilo", "kilo-auto/frontier"),
        ...(state === "disabled" ? [{ ...router, enabled: false }] : []),
      ])
      expect(yield* KiloSmallModel.select(models, primary.providerID)).toBeUndefined()
      expect(yield* KiloSmallModel.select(models, router.providerID)).toBeUndefined()
    }),
  )
}

test("keeps legacy small_model below explicit legacy and native title models", () => {
  const legacy = { small_model: "kilo/kilo-auto/small" }
  expect(ConfigNormalize.normalize(legacy)).toMatchObject({
    encoded: { agents: { title: { model: { providerID: "kilo", model: "kilo-auto/small" } } } },
  })
  expect(ConfigNormalize.normalize({ ...legacy, agent: { title: { model: "local/legacy-title" } } })).toMatchObject({
    encoded: { agents: { title: { model: { providerID: "local", model: "legacy-title" } } } },
  })
  expect(
    ConfigNormalize.normalize({
      ...legacy,
      agent: { title: { model: "local/legacy-title" } },
      agents: { title: { model: "local/native-title" } },
    }),
  ).toMatchObject({ encoded: { agents: { title: { model: { providerID: "local", model: "native-title" } } } } })
})
