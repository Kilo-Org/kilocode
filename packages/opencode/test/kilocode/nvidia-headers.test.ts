import { expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Env } from "../../src/env"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"

const it = testEffect(Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer, CrossSpawnSpawner.defaultLayer))

function withNvidiaKey<A, E, R>(self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const env = yield* Env.Service
    yield* env.set("NVIDIA_API_KEY", "test-api-key")
    yield* Effect.addFinalizer(() => env.remove("NVIDIA_API_KEY"))
    return yield* self
  })
}

it.live("nvidia provider includes KiloCode billing origin header", () =>
  provideTmpdirInstance(() =>
    withNvidiaKey(
      Provider.Service.use((provider) =>
        Effect.gen(function* () {
          const providers = yield* provider.list()
          const headers = providers[ProviderID.make("nvidia")].options.headers

          expect(headers["HTTP-Referer"]).toBe("https://opencode.ai/")
          expect(headers["X-Title"]).toBe("opencode")
          expect(headers["X-BILLING-INVOKE-ORIGIN"]).toBe("KiloCode")
        }),
      ),
    ),
  ),
)

it.live("nvidia billing origin header can be overridden from config", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
            provider: {
              nvidia: {
                options: {
                  headers: {
                    "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
                  },
                },
              },
            },
          }),
        ),
      )

      return yield* withNvidiaKey(
        Provider.Service.use((provider) =>
          Effect.gen(function* () {
            const providers = yield* provider.list()
            const headers = providers[ProviderID.make("nvidia")].options.headers

            expect(headers["HTTP-Referer"]).toBe("https://opencode.ai/")
            expect(headers["X-Title"]).toBe("opencode")
            expect(headers["X-BILLING-INVOKE-ORIGIN"]).toBe("CustomOrigin")
          }),
        ),
      )
    }),
  ),
)
