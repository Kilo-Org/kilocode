import { expect } from "bun:test"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Rpc } from "@opencode/core/rpc"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloHost } from "../src/host"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const diagnostic = "Failed to load the Kilo model catalog (HTTP 503). Check your connection and credentials."
const Definition = Rpc.define({
  id: KiloGatewayRpc.Definition.id,
  methods: { models: KiloGatewayRpc.Definition.methods.models },
  events: {},
})
const session = Session.Info.make({
  id: Session.ID.create(),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: { directory: AbsolutePath.make("/catalog-errors") },
})

// Compile the upstream runner node through the actual host replacement and its declared dependencies.
const runner = (resolver: ModelResolver.Interface, rpc: Rpc.Interface) =>
  LayerNode.compile(SessionRunnerModel.node, {
    replacements: [
      ...KiloHost.overrides,
      ModelResolver.node.replace(Layer.succeed(ModelResolver.Service, resolver)),
      Rpc.node.replace(Layer.succeed(Rpc.Service, rpc)),
    ],
  })

it.effect("adds catalog diagnostics only for no default or an unavailable selected Kilo model", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    let calls = 0
    yield* rpc.register(Definition, {
      models: (_input, context) =>
        Effect.sync(() => calls++).pipe(
          Effect.andThen(
            Effect.fail(context.error("failed", "Catalog wording can change", { kind: "http", status: 503 })),
          ),
        ),
    })
    yield* Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      const missing = yield* models.resolve(session, () => Effect.succeed([])).pipe(Effect.flip)
      expect(missing).toBeInstanceOf(SessionRunnerModel.ModelNotSelectedError)
      expect(missing.message).toBe(diagnostic)
      for (const providerID of [kilo, Provider.ID.make("azure-cognitive-services")]) {
        const failure = yield* models
          .resolve({ ...session, model: { providerID, id: Model.ID.make("missing") } }, () => Effect.succeed([]))
          .pipe(Effect.flip)
        expect(failure).toBeInstanceOf(SessionRunnerModel.ModelUnavailableError)
        expect(failure.message).toBe(
          providerID === kilo
            ? diagnostic
            : "Model unavailable: azure-cognitive-services/missing. This provider has been deprecated; use azure/missing instead.",
        )
      }
      expect(calls).toBe(2)
    }).pipe(
      Effect.provide(
        runner({ resolve: () => Effect.undefined, resolveModel: () => Effect.die("Unexpected model resolution") }, rpc),
      ),
    )
  }),
)

it.effect("does not call the catalog RPC when default or explicit model resolution succeeds", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    let calls = 0
    yield* rpc.register(Definition, {
      models: () =>
        Effect.sync(() => {
          calls++
          return []
        }),
    })
    const model = {
      ...Model.Info.default(kilo, Model.ID.make("healthy")),
      package: "@opencode/ai/providers/openrouter",
    }
    const resolved = SessionRunnerModel.resolved(yield* ModelResolver.fromCatalogModel(model), model)
    yield* Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      expect(yield* models.resolve(session, () => Effect.die("Default must not sample availability"))).toBe(resolved)
      expect(
        yield* models.resolve(
          { ...session, model: { providerID: kilo, id: model.id, variant: Model.VariantID.make("high") } },
          () => Effect.succeed([model]),
        ),
      ).toBe(resolved)
      expect(calls).toBe(0)
    }).pipe(
      Effect.provide(
        runner(
          {
            resolve: () => Effect.succeed(resolved),
            resolveModel: (selected, variant) => {
              expect(selected).toBe(model)
              expect(variant).toBe(Model.VariantID.make("high"))
              return Effect.succeed(resolved)
            },
          },
          rpc,
        ),
      ),
    )
  }),
)

it.effect("formats typed failure data without exposing arbitrary RPC messages or malformed output", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    const resolver = { resolve: () => Effect.undefined, resolveModel: () => Effect.die("Unexpected model resolution") }
    for (const kind of ["network", "schema", "http", "unauthorized"] as const) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* rpc.register(Definition, {
            models: (_input, context) =>
              Effect.fail(
                context.error("failed", "private-token https://server.test/?secret=private-param private-body", {
                  kind,
                }),
              ),
          })
          const error = yield* Effect.gen(function* () {
            const models = yield* SessionRunnerModel.Service
            return yield* models.resolve(session, () => Effect.succeed([]))
          }).pipe(Effect.provide(runner(resolver, rpc)), Effect.flip)
          expect(error.message).toBe(
            `Failed to load the Kilo model catalog (${kind}). Check your connection and credentials.`,
          )
        }),
      )
    }
    yield* rpc.register(
      Rpc.define({
        id: Definition.id,
        methods: {
          models: { input: Definition.methods.models.input, output: { type: "array", items: { type: "object" } } },
        },
        events: {},
      }),
      { models: () => Effect.succeed("private-body") },
    )
    const malformed = yield* rpc.call(Definition.id, "models", {}).pipe(Effect.flip)
    expect(malformed.type).toBe("rpc.invalid_output")
    const error = yield* Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      return yield* models.resolve(session, () => Effect.succeed([]))
    }).pipe(Effect.provide(runner(resolver, rpc)), Effect.flip)
    expect(error.message).toBe(`No model is available for session ${session.id}`)
  }),
)
