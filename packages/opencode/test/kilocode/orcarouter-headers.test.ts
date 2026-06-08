import { expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Env } from "../../src/env"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { DEFAULT_HEADERS } from "../../src/kilocode/const"

const it = testEffect(Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer, CrossSpawnSpawner.defaultLayer))

function withOrcaRouterKey<A, E, R>(self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const env = yield* Env.Service
    yield* env.set("ORCAROUTER_API_KEY", "test-api-key")
    yield* Effect.addFinalizer(() => env.remove("ORCAROUTER_API_KEY"))
    return yield* self
  })
}

it.live("orcarouter provider includes Kilo Code attribution headers", () =>
  provideTmpdirInstance(() =>
    withOrcaRouterKey(
      Provider.Service.use((provider) =>
        Effect.gen(function* () {
          const providers = yield* provider.list()
          const headers = providers[ProviderID.make("orcarouter")].options.headers

          expect(headers["HTTP-Referer"]).toBe(DEFAULT_HEADERS["HTTP-Referer"])
          expect(headers["X-Title"]).toBe(DEFAULT_HEADERS["X-Title"])
        }),
      ),
    ),
  ),
)

it.live("orcarouter attribution headers can be overridden from config", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
            provider: {
              orcarouter: {
                options: {
                  headers: {
                    "X-Title": "Custom Title",
                  },
                },
              },
            },
          }),
        ),
      )

      return yield* withOrcaRouterKey(
        Provider.Service.use((provider) =>
          Effect.gen(function* () {
            const providers = yield* provider.list()
            const headers = providers[ProviderID.make("orcarouter")].options.headers

            expect(headers["HTTP-Referer"]).toBe(DEFAULT_HEADERS["HTTP-Referer"])
            expect(headers["X-Title"]).toBe("Custom Title")
          }),
        ),
      )
    }),
  ),
)
